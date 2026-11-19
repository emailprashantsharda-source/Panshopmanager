/* Staff360 v2 — owner/manager app shell, router and dashboard. Other screens live in views-*.js. */
(function () {
  'use strict';
  var St = window.S360Store, U = window.S360UI;
  var esc = U.esc, ic = U.ic, $ = function (s, r) { return (r || document).querySelector(s); };

  // ---------- shell ----------
  var NAV = [
    ['dashboard', 'Dashboard', 'dash'], ['staff', 'Staff', 'users'], ['attendance', 'Attendance', 'calc'],
    ['shifts', 'Shifts & Schedules', 'clock', 'shifts'], ['leave', 'Leave Management', 'leave', 'leave'],
    ['reports', 'Reports & Analytics', 'bars'], ['ai', 'AI Staff Manager', 'crown', 'ai', 'PRO'],
    'sep', ['settings', 'Settings', 'gear'], ['plans', 'Subscription', 'star'], ['help', 'Help & Support', 'help'],
  ];
  var ui = U.ui = { route: 'dashboard', arg: '', pop: null, collapsed: false, drawer: false, q: '' };
  try { ui.collapsed = localStorage.getItem('s360v2.collapsed') === '1'; } catch (e) { /* ignore */ }

  function sideHTML() {
    var items = NAV.map(function (n) {
      if (n === 'sep') return '<div class="sep" role="separator"></div>';
      var locked = n[3] && !St.can(n[3]), on = ui.route === n[0];
      return '<a class="nav-i' + (on ? ' on' : '') + '" href="#/' + n[0] + '"' + (on ? ' aria-current="page"' : '') + ' title="' + n[1] + '">' + ic(n[2]) + '<span class="lbl">' + n[1] + '</span>' +
        (n[4] ? '<span class="tag">' + n[4] + '</span>' : locked ? ic('lock', 'lk') : '') + '</a>';
    }).join('');
    var up = St.plan !== 'kingpro' ? '<div class="upsell"><b>' + ic('crown') + 'King PRO</b><p>AI staff insights, late-arrival alerts and salary estimates. ' + St.priceLabel('kingpro') + '.</p><a class="btn pri sm" href="#/plans" style="width:100%">Upgrade plan</a></div>' : '';
    return '<div class="logo">' + U.LOGO + '<span>HisaabNow<small>Staff360</small></span></div>' +
      '<nav aria-label="Staff360">' + items + '</nav><div class="grow"></div>' + up + (St.live ? '' :
      '<div class="demo-plans"><small>Demo plan (preview only)</small><div>' + ['basic', 'premium', 'kingpro'].map(function (p) {
        return '<button class="' + (St.plan === p ? 'on' : '') + '" data-a="plan:' + p + '" aria-pressed="' + (St.plan === p) + '">' + St.PLAN_LABEL[p] + '</button>';
      }).join('') + '</div></div>');
  }

  function topHTML() {
    var b = St.business, n = St.notifications().length;
    return (window.S360_BACK ? '<button class="pill-btn back-hn" data-a="back" aria-label="Back to HisaabNow">' + ic('left') + '<span class="hide-sm">HisaabNow</span></button>' : '') +
      '<button class="icon-btn burger" data-a="drawer" aria-label="Open menu">' + ic('menu') + '</button>' +
      '<button class="icon-btn collapse-btn" data-a="collapse" aria-label="' + (ui.collapsed ? 'Expand' : 'Collapse') + ' sidebar">' + ic('side') + '</button>' +
      '<div class="anchor shop-a"><button class="pill-btn" data-a="pop:shop" aria-haspopup="true" aria-expanded="' + (ui.pop === 'shop') + '">' + ic('store') + '<span class="t">' + esc(b.name) + (b.city && !St.live ? '<span class="hide-sm">, ' + esc(b.city) + '</span>' : '') + '</span>' + ic('chev') + '</button>' + (ui.pop === 'shop' ? shopPop() : '') + '</div>' +
      '<span class="pill-btn hide-md" style="font-weight:500">' + ic('cal') + U.dLabel(St.today, true) + '</span>' +
      '<div class="search' + (ui.pop === 'search' ? ' open' : '') + ' anchor"><label class="sr" for="s360-q">Search staff</label>' + ic('search') +
      '<input id="s360-q" type="search" placeholder="Search staff by name, ID or mobile" autocomplete="off" value="' + esc(ui.q) + '"><kbd>/</kbd>' +
      '<button class="icon-btn s-btn" data-a="pop:search" aria-label="Search">' + ic('search') + '</button>' + (ui.pop === 'search' && ui.q ? searchPop() : '') + '</div>' +
      (St.live ? '<a class="plan-chip live hide-sm" href="#/plans" title="Your plan">' + (St.plan === 'kingpro' ? ic('crown') : '') + St.PLAN_LABEL[St.plan] + '</a>' :
      '<div class="anchor hide-sm"><button class="plan-chip" data-a="pop:plan" aria-haspopup="true" title="Demo only: preview each plan">Demo plan: ' + St.PLAN_LABEL[St.plan] + ic('chev') + '</button>' + (ui.pop === 'plan' ? planPop() : '') + '</div>') +
      '<div class="anchor"><button class="icon-btn" data-a="pop:bell" aria-label="Notifications, ' + n + ' new">' + ic('bell') + (n ? '<span class="dot"></span>' : '') + '</button>' + (ui.pop === 'bell' ? bellPop() : '') + '</div>' +
      '<div class="anchor"><button class="pill-btn" style="border:0;padding:0 4px" data-a="pop:me" aria-label="Account menu"><span class="avatar" style="background:var(--primary);color:#fff">' + (b.owner ? U.initials(b.owner) : ic('user')) + '</span><span class="hide-sm">' + esc(b.ownerFirst || (St.role === 'manager' ? 'Manager' : 'Owner')) + '</span>' + ic('chev', 'hide-sm') + '</button>' + (ui.pop === 'me' ? mePop() : '') + '</div>';
  }
  function shopPop() {
    if (St.live) {
      var cur = (St.businesses.filter(function (x) { return x.name === St.business.name; })[0] || {}).id;
      return '<div class="pop" role="menu" style="left:0"><div class="hd">Your businesses</div>' + St.businesses.map(function (x) {
        var on = x.id === cur;
        return '<button class="it' + (on ? ' on' : '') + '" data-a="tenant:' + esc(x.id) + '" role="menuitem">' + ic('store') + '<span>' + esc(x.name) + '<small>' + esc(x.city) + (on ? ' · current' : '') + '</small></span></button>';
      }).join('') + (window.S360_BACK ? '<div class="hd" style="text-transform:none;font-weight:500;letter-spacing:0">Switch shops in the HisaabNow app</div>' : '<button class="it" data-a="newbiz" role="menuitem">' + ic('plus') + '<span>Set up another business</span></button>') + '</div>';
    }
    return '<div class="pop" role="menu" style="left:0"><div class="hd">Your businesses</div>' + St.businesses.map(function (x, i) {
      return '<button class="it' + (i === 0 ? ' on' : '') + '" data-a="shop:' + i + '" role="menuitem">' + ic('store') + '<span>' + esc(i === 0 ? St.business.name : x.name) + '<small>' + esc(i === 0 ? St.business.city : x.city) + (i === 0 ? ' · current' : '') + '</small></span></button>';
    }).join('') + '</div>';
  }
  function planPop() {
    return '<div class="pop" role="menu" style="right:0"><div class="hd">Demo only — preview plan gating</div>' + ['basic', 'premium', 'kingpro'].map(function (p) {
      return '<button class="it' + (St.plan === p ? ' on' : '') + '" data-a="plan:' + p + '" role="menuitemradio" aria-checked="' + (St.plan === p) + '">' + (St.plan === p ? ic('check') : '<span style="width:18px"></span>') + '<span>' + St.PLAN_LABEL[p] + '<small>' + { basic: 'Owner marks attendance', premium: '+ staff check-in, shifts, leave', kingpro: '+ AI, insights, salary estimate' }[p] + '</small></span></button>';
    }).join('') + '</div>';
  }
  function bellPop() {
    var list = St.notifications().slice(0, 6);
    return '<div class="pop" role="menu" style="right:0;width:300px"><div class="hd">Notifications</div>' + (list.length ? list.map(function (n) {
      return '<a class="it" href="' + n.go + '" role="menuitem">' + ic('bell') + '<span>' + esc(n.text) + '<small>' + esc(n.at) + '</small></span></a>';
    }).join('') : '<div class="empty">You’re all caught up.</div>') + (St.live ? '' : '<div class="hd" style="text-transform:none;font-weight:500;letter-spacing:0">Sample notifications · WhatsApp alerts are not sent in this preview</div>') + '</div>';
  }
  function mePop() {
    if (St.live) {
      var u = St.backend().user();
      return '<div class="pop" role="menu" style="right:0"><div class="it" style="cursor:default"><span>' + esc(u.phoneNumber || St.business.owner || '') + '<small>' + (St.role === 'manager' ? 'Manager' : 'Owner') + ' · ' + esc(St.business.name) + '</small></span></div>' +
        (St.role === 'owner' ? '<a class="it" href="#/settings" role="menuitem">' + ic('gear') + '<span>Settings</span></a>' : '') +
        '<a class="it" href="#/help" role="menuitem">' + ic('help') + '<span>Help &amp; support</span></a>' +
        (window.S360_BACK ? '<button class="it" data-a="back" role="menuitem">' + ic('left') + '<span>Back to HisaabNow</span></button>' : '<button class="it" data-a="signout" role="menuitem">' + ic('logout') + '<span>Log out</span></button>') + '</div>';
    }
    return '<div class="pop" role="menu" style="right:0"><div class="it" style="cursor:default"><span>' + esc(St.business.owner) + '<small>Owner · ' + esc(St.business.name) + '</small></span></div>' +
      '<a class="it" href="employee.html" role="menuitem">' + ic('phone') + '<span>Open employee portal<small>See what staff see</small></span></a>' +
      '<a class="it" href="#/settings" role="menuitem">' + ic('gear') + '<span>Settings</span></a>' +
      '<button class="it" data-a="soon:Sign out is disabled in the demo" role="menuitem">' + ic('logout') + '<span>Sign out<small>Disabled in the demo</small></span></button></div>';
  }
  function searchPop() {
    var q = ui.q.toLowerCase(), hits = St.staff({ all: true }).filter(function (p) { return (p.name + ' ' + p.id + ' ' + p.mobile + ' ' + p.designation).toLowerCase().indexOf(q) >= 0; }).slice(0, 6);
    return '<div class="pop" role="listbox" style="left:0;right:0">' + (hits.length ? '<div class="hd">Staff</div>' + hits.map(function (p) {
      return '<a class="it" href="#/staff/' + p.id + '" role="option">' + U.avatar(p, 28) + '<span>' + esc(p.name) + '<small>' + esc(p.id + ' · ' + p.designation) + (p.status !== 'Active' ? ' · Inactive' : '') + '</small></span></a>';
    }).join('') : '<div class="empty">No staff match “' + esc(ui.q) + '”</div>') + '</div>';
  }

  // ---------- dashboard ----------
  U.views.dashboard = function () {
    var today = St.today, rows = St.day(today), active = rows.length, inactive = St.staff({ all: true }).length - active;
    var cnt = { in: 0, late: 0, absent: 0, leave: 0, weeklyoff: 0, notin: 0 };
    rows.forEach(function (x) {
      var r = x.rec; if (!r) { cnt.notin++; return; }
      // Present by status: an owner can mark Present without a check-in time.
      if (r.status === 'present' || r.status === 'late' || r.status === 'halfday') { cnt.in++; if (r.status === 'late') cnt.late++; } else if (cnt[r.status] != null) cnt[r.status]++;
    });
    var scheduled = active - cnt.weeklyoff - cnt.leave, pct = scheduled ? cnt.in / scheduled : 0;
    var monthRecs = St.range(U.monthStart(today), today).filter(function (r) { var p = St.person(r.staff); return p && p.status === 'Active'; });
    var c = U.count(monthRecs), done = monthRecs.filter(function (r) { return r.date < today; });
    var avgHours = U.avg(done.map(U.worked)), avgOut = U.avg(done.filter(function (r) { return r.out && r.status !== 'halfday'; }).map(function (r) { return U.toMin(r.out); }));
    var onTime = (c.present + c.late) ? c.present / (c.present + c.late) : null;
    var pend = St.leaves().filter(function (l) { return l.status === 'Pending'; });
    var avgIn = U.avg(rows.filter(function (x) { return U.isIn(x.rec); }).map(function (x) { return U.toMin(x.rec.in); }));
    var hr = new Date().getHours(), greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    var canCI = St.can('checkin_metrics');

    var h = '<div class="page-h"><div><h1>' + greet + (St.business.ownerFirst ? ', ' + esc(St.business.ownerFirst) : '') + '!</h1><p>' +
      (pend.length && St.can('leave') ? '<a href="#/leave">' + pend.length + ' leave request' + (pend.length > 1 ? 's' : '') + ' pending</a> · ' : '') +
      (cnt.late && canCI ? cnt.late + ' late arrival' + (cnt.late > 1 ? 's' : '') + ' today · ' : '') + 'Here’s your team today.</p></div>' +
      '<div class="ph-act">' + (St.live ? '' : '<span class="sample">' + ic('alert') + 'Sample data</span>') +
      '<div class="clock"><div><small>Current time</small><b id="s360-clock">' + U.dLabel(today) + ', ' + U.t12(new Date().getHours() * 60 + new Date().getMinutes()) + '</b></div>' + ic('clock') + '</div></div></div>';

    h += '<div class="qa">' + [
      ['userplus', 'Add Employee', 'staff-add', 'var(--blue-light)', 'var(--blue)'],
      ['calc', 'Mark Attendance', 'nav:attendance', 'var(--primary-light)', 'var(--primary)'],
      ['eye', 'View Attendance', 'att-calendar', 'var(--purple-light)', 'var(--purple)'],
      ['report', 'Generate Report', 'nav:reports', 'var(--orange-light)', 'var(--orange)'],
    ].map(function (q) { return '<button data-a="' + q[2] + '"><span class="qi" style="background:' + q[3] + ';color:' + q[4] + '">' + ic(q[0]) + '</span>' + q[1] + '</button>'; }).join('') + '</div>';

    h += '<div class="kpis">' +
      U.kpi('users', 'Total Staff', active, inactive ? inactive + ' inactive' : 'All active', 'var(--blue-light)', 'var(--blue)') +
      U.kpi('check', 'Present Today', cnt.in, !canCI ? 'Marked by owner' : cnt.late ? cnt.late + ' late' : 'All on time', 'var(--success-light)', 'var(--success)') +
      U.kpi('x', 'Absent Today', cnt.absent, cnt.notin ? cnt.notin + ' not marked yet' : '—', 'var(--danger-light)', 'var(--danger)') +
      U.kpi('leave', 'On Leave', cnt.leave, cnt.weeklyoff + ' on weekly off', 'var(--orange-light)', 'var(--orange)') + '</div>';

    var notIn = rows.filter(function (x) { return !x.rec || x.rec.status === 'absent' || x.rec.status === 'notin'; });
    h += '<div class="row r-top">';
    h += '<section class="card today"><div class="card-h"><h2>Today</h2>' + (notIn.length ? '<span class="badge b-red">' + notIn.length + ' not in</span>' : '<span class="badge b-green">Everyone in</span>') + '</div>' +
      '<div class="body"><div style="flex:1;min-width:0"><p>' + cnt.in + ' of ' + scheduled + ' scheduled staff are in.</p>' +
      '<p class="big">' + (notIn.length ? 'Waiting for: ' + notIn.slice(0, 3).map(function (x) { return esc(x.person.name.split(' ')[0]); }).join(', ') + (notIn.length > 3 ? ' +' + (notIn.length - 3) : '') : 'No one is missing.') + '</p></div>' +
      U.ring([[cnt.in, 'var(--success)'], [Math.max(scheduled - cnt.in, 0), '#F5B82E']], 120, 12, '<b>' + Math.round(pct * 100) + '%</b><small>present</small>') + '</div>' +
      '<button class="btn pri" data-a="nav:attendance" style="margin-top:14px;width:100%">' + ic('calc') + 'Mark attendance</button></section>';

    var minis = [
      ['clock', 'Average hours', U.dur(avgHours), 'var(--blue-light)', 'var(--blue)'],
      ['login', 'Average check-in today', U.t12(avgIn), 'var(--primary-light)', 'var(--primary)'],
      ['target', 'On-time arrival', onTime == null ? '—' : (Math.round(onTime * 1000) / 10) + '%', 'var(--success-light)', 'var(--success)', 1],
      ['logout', 'Average check-out', U.t12(avgOut), 'var(--orange-light)', 'var(--orange)'],
    ];
    h += '<div class="mini">' + minis.map(function (m) {
      return '<div class="card' + (canCI ? '' : ' locked') + '"><span class="mi" style="background:' + m[3] + ';color:' + m[4] + '">' + ic(m[0]) + '</span><small>' + m[1] + '</small><b' + (m[5] ? ' class="good"' : '') + '>' + m[2] + '</b>' +
        (canCI ? '' : '<div class="veil">' + ic('lock') + '<b>Premium</b>Needs staff check-in</div>') + '</div>';
    }).join('') + '</div>';

    var segs = [['On time', c.present, 'var(--success)'], ['Late', c.late, 'var(--warning)'], ['Half day', c.halfday, 'var(--orange)'], ['Absent', c.absent, 'var(--danger)'], ['On leave', c.leave, 'var(--purple)']];
    h += '<section class="card donut-card"><div class="card-h"><h2>Attendance this month</h2><a href="#/reports">View stats</a></div><div class="donut-wrap"><ul>' +
      segs.map(function (s) { return '<li><span><i class="dot-s" style="background:' + s[2] + '"></i>' + s[0] + '</span><b>' + s[1] + '</b></li>'; }).join('') + '</ul>' +
      U.ring(segs.map(function (s) { return [s[1], s[2]]; }), 132, 14, '<b>' + Math.round((c.rate || 0) * 100) + '%</b><small>attendance<br>' + c.workdays + ' staff-days</small>') + '</div></section>';
    h += '</div>';

    var past = [1, 2].map(function (n) { return U.addDays(today, -n); });
    h += '<div class="row r-2"><section class="card"><div class="card-h"><h2>My Team</h2><a href="#/attendance">View all</a></div>' +
      '<div class="legend">' + ['present', 'late', 'halfday', 'absent', 'leave', 'weeklyoff'].map(function (k) { return '<span><i style="background:' + U.STATUS[k][1] + '"></i>' + U.STATUS[k][0] + '</span>'; }).join('') + '</div>' +
      '<div class="tbl-wrap"><table class="t"><thead><tr><th>Member</th><th>Today</th>' + past.map(function (d) { return '<th>' + U.dLabel(d) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.slice(0, 7).map(function (x) {
        return '<tr><td><a class="who" href="#/staff/' + x.person.id + '">' + U.avatar(x.person) + '<span><b>' + esc(x.person.name) + '</b><small>' + esc(x.person.designation) + ' · ' + x.person.id + '</small></span></a></td><td>' + U.statusCell(x.rec) + '</td>' +
          past.map(function (d) { return '<td>' + U.statusCell(St.record(x.person.id, d)) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div></section>';

    var hist = [0, 1, 2, 3, 4, 5].map(function (n) {
      var d = U.addDays(today, -n), recs = St.day(d).map(function (x) { return x.rec; }).filter(Boolean);
      var ins = recs.filter(U.isIn), sched = recs.filter(function (r) { return r.status !== 'weeklyoff' && r.status !== 'leave'; }).length;
      return { d: d, ins: ins.length, sched: sched, arr: U.avg(ins.map(function (r) { return U.toMin(r.in); })), dep: U.avg(ins.filter(function (r) { return r.out; }).map(function (r) { return U.toMin(r.out); })), hrs: U.avg(ins.map(U.worked)) };
    });
    h += '<section class="card"><div class="card-h"><h2>Working History</h2><a href="#/attendance">Open register</a></div>' +
      '<div class="legend"><span><i style="background:var(--success)"></i>8h+ average</span><span><i style="background:var(--warning)"></i>Under 8h</span><span><i style="background:var(--blue)"></i>Day in progress</span></div>' +
      '<div class="tbl-wrap"><table class="t"><thead><tr><th>Date</th><th>Present</th><th>Avg arrival</th><th>Avg departure</th><th style="text-align:right">Avg effective time</th></tr></thead><tbody>' +
      hist.map(function (x, i) {
        var live = i === 0, col = live ? 'var(--blue)' : (x.hrs || 0) >= 480 ? 'var(--success)' : 'var(--warning)';
        return '<tr><td><a href="#/attendance/' + x.d + '"><b style="color:var(--heading)">' + (live ? 'Today' : U.dLabel(x.d)) + '</b></a><br><small class="muted">' + U.DOW[U.parse(x.d).getDay()] + '</small></td><td>' + x.ins + '/' + x.sched + '</td><td>' + U.t12(x.arr) + '</td><td>' + (live && !x.dep ? '<span class="muted">Still in store</span>' : U.t12(x.dep)) + '</td>' +
          '<td><div class="hours"><span>' + (live ? '<span class="muted">In progress</span>' : U.dur(x.hrs) + '<br><small class="muted">of 8h</small>') + '</span>' + U.pctRing(live ? 0.5 : (x.hrs || 0) / 480, 26, 4, col) + '</div></td></tr>';
      }).join('') + '</tbody></table></div></section></div>';

    var lates = rows.filter(function (x) { return x.rec && x.rec.status === 'late'; });
    h += '<div class="row r-3"><section class="card"><div class="card-h"><h2>Late arrivals today</h2><span class="badge b-amber">' + lates.length + '</span></div>' +
      (lates.length ? '<ul class="list">' + lates.map(function (x) {
        var sh = St.shift(x.person.shift);
        return '<li>' + U.avatar(x.person) + '<span class="grow"><b>' + esc(x.person.name) + '</b><small>' + (sh ? sh.name + ' shift · ' : '') + 'in at ' + U.hm12(x.rec.in) + '</small></span><span class="badge b-amber">+' + U.lateMin(x.rec) + ' min</span></li>';
      }).join('') + '</ul>' : '<div class="empty">No late arrivals today.</div>') +
      (canCI ? '' : '<p class="muted" style="font-size:12px;margin-top:8px">' + ic('lock') + ' Late times come from staff check-in (Premium).</p>') + '</section>';

    h += '<section class="card"><div class="card-h"><h2>Pending leave requests</h2><a href="#/leave">View all</a></div>' +
      (!St.can('leave') ? '<div class="empty">' + ic('lock') + '<br>Leave requests from staff are on Premium.</div>' :
      pend.length ? '<ul class="list">' + pend.slice(0, 4).map(function (l) {
        var p = St.person(l.staff);
        return '<li>' + U.avatar(p) + '<span class="grow"><b>' + esc(p.name) + '</b><small>' + l.type + ' · ' + U.dLabel(l.from) + (l.days > 1 ? ' – ' + U.dLabel(l.to) : '') + ' · ' + l.days + ' day' + (l.days > 1 ? 's' : '') + '</small></span>' +
          '<span class="act"><button class="ok" data-a="leave-decide:' + l.id + ':Approved" aria-label="Approve leave for ' + esc(p.name) + '">' + ic('check') + '</button><button class="no" data-a="leave-decide:' + l.id + ':Rejected" aria-label="Reject leave for ' + esc(p.name) + '">' + ic('x') + '</button></span></li>';
      }).join('') + '</ul>' : '<div class="empty">' + ic('check') + '<br>All caught up — no pending requests.</div>') + '</section>';

    var offs = [];
    for (var n = 1; n <= 7 && offs.length < 6; n++) {
      var d = U.addDays(today, n), dow = U.parse(d).getDay();
      St.staff().forEach(function (p) { if (p.weeklyOff === dow && offs.length < 6) offs.push({ p: p, d: d }); });
    }
    h += '<section class="card"><div class="card-h"><h2>Upcoming weekly offs</h2><a href="#/shifts">Schedules</a></div><ul class="list">' +
      offs.map(function (o) { return '<li>' + U.avatar(o.p) + '<span class="grow"><b>' + esc(o.p.name) + '</b><small>' + esc(o.p.designation) + '</small></span><span class="badge b-grey">' + U.DOW[U.parse(o.d).getDay()] + ', ' + U.dLabel(o.d) + '</span></li>'; }).join('') +
      '</ul></section></div>';
    return h;
  };

  // ---------- render ----------
  var root;
  // What the person has typed into forms on this screen, kept across background refreshes.
  var dirty = {};
  function formKey(f) { return f && (f.id || f.getAttribute('data-set')); }
  function keyFor(t) { if (t.id) return t.id; var fk = formKey(t.form); return fk && t.name ? fk + '|' + t.name : null; }
  function fieldFor(k) {
    if (k.indexOf('|') < 0) return document.getElementById(k);
    var parts = k.split('|'), f = document.getElementById(parts[0]) || document.querySelector('form[data-set="' + parts[0] + '"]');
    return f ? f.querySelector('[name="' + parts[1] + '"]') : null;
  }
  function render() {
    root.className = 'app' + (ui.collapsed ? ' collapsed' : '') + (ui.drawer ? ' drawer' : '');
    var ae = document.activeElement, fid = ae && ae.id && root.contains(ae) ? ae.id : null, caret = null;
    try { caret = fid && ae.selectionStart; } catch (e) { caret = null; }
    var view = U.views[ui.route], body;
    try { body = view ? view(ui.arg) : U.views.notfound(); }
    catch (err) { if (window.console) console.warn(err); body = '<div class="card placeholder"><h1>Something went wrong</h1><p>This screen could not load. Try again, or go back to the dashboard.</p><a class="btn" href="#/dashboard">Back to dashboard</a></div>'; }
    root.innerHTML = '<aside class="side" id="s360-side">' + sideHTML() + '</aside><div class="scrim" data-a="drawer"></div>' +
      '<div class="main"><header class="top">' + topHTML() + '</header><main class="content" id="s360-main" tabindex="-1">' + backHTML() + body + '</main></div>';
    Object.keys(dirty).forEach(function (k) {
      var d = fieldFor(k); if (!d || d.getAttribute('data-f')) return;
      if (d.type === 'checkbox' || d.type === 'radio') d.checked = dirty[k]; else d.value = dirty[k];
    });
    if (fid) { var el = document.getElementById(fid); if (el) { el.focus(); if (caret != null) try { el.setSelectionRange(caret, caret); } catch (e) { /* not a text input */ } } }
    if (U.afterRender) U.afterRender();
  }
  /* Back button above every section except the dashboard. Goes to the parent screen
   * (a staff profile → Staff, corrections → Leave, a section → Dashboard). On wide
   * screens, where the sidebar is always visible, it shows only on sub-screens. */
  var NAMES = { staff: 'Staff', attendance: 'Attendance', leave: 'Leave', shifts: 'Shifts', reports: 'Reports', settings: 'Settings' };
  function backHTML() {
    if (ui.route === 'dashboard') return '';
    var sub = ui.arg && !/^\d{4}-\d{2}-\d{2}$/.test(ui.arg) && ui.arg !== 'calendar';
    var to = sub && NAMES[ui.route] ? '#/' + ui.route : '#/dashboard', label = sub && NAMES[ui.route] ? NAMES[ui.route] : 'Dashboard';
    return '<a class="back-row' + (sub ? ' sub' : '') + '" href="' + to + '">' + U.ic('left') + 'Back to ' + label + '</a>';
  }
  U.render = function () { if (root) render(); };
  U.clean = function (form) { [].forEach.call(form.querySelectorAll('input,select,textarea'), function (el) { var k = keyFor(el); if (k) delete dirty[k]; }); };
  U.views.notfound = function () { return '<div class="card placeholder"><h1>Page not found</h1><p>That screen doesn’t exist.</p><a class="btn" href="#/dashboard">Back to dashboard</a></div>'; };

  function route() {
    var r = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
    var changed = ui.route !== r[0] || ui.arg !== r.slice(1).join('/');
    if (changed) dirty = {};
    U.closeModal();
    ui.route = r[0]; ui.arg = r.slice(1).join('/'); ui.pop = null; ui.drawer = false; ui.q = '';
    render();
    if (changed) { window.scrollTo(0, 0); var m = $('#s360-main'); if (m && document.activeElement === document.body) m.focus({ preventScroll: true }); }
  }

  function onClick(e) {
    if (e.target.closest('#s360-modal')) return;
    var t = e.target.closest('[data-a]');
    if (!t) { if (ui.pop && !e.target.closest('.pop')) { ui.pop = null; render(); } return; }
    var a = t.getAttribute('data-a'), parts = a.split(':');
    if (a === 'drawer') { ui.drawer = !ui.drawer; render(); return; }
    if (a === 'collapse') { ui.collapsed = !ui.collapsed; try { localStorage.setItem('s360v2.collapsed', ui.collapsed ? '1' : '0'); } catch (x) { /* ignore */ } render(); return; }
    if (parts[0] === 'pop') { ui.pop = ui.pop === parts[1] ? null : parts[1]; render(); if (ui.pop === 'search') { var q = $('#s360-q'); if (q) q.focus(); } return; }
    if (parts[0] === 'nav') { location.hash = '#/' + parts.slice(1).join(':'); return; }
    if (parts[0] === 'plan') { ui.pop = null; St.setPlan(parts[1]); U.toast('Previewing ' + St.PLAN_LABEL[parts[1]] + ' (demo only)'); return; }
    if (parts[0] === 'shop') { ui.pop = null; render(); if (parts[1] !== '0') U.toast('Switching business connects in the live build'); return; }
    if (parts[0] === 'tenant') { ui.pop = null; St.backend().switchTenant(parts.slice(1).join(':')); return; }
    if (a === 'newbiz') { ui.pop = null; St.backend().newBusiness(); return; }
    if (a === 'signout') { ui.pop = null; St.backend().signOut(); return; }
    if (a === 'back') { ui.pop = null; window.S360_BACK(); return; }
    if (parts[0] === 'soon') { ui.pop = null; render(); U.toast(parts.slice(1).join(':')); return; }
    if (U.actions[parts[0]]) { e.preventDefault(); ui.pop = null; U.actions[parts[0]](parts.slice(1), t, e); return; }
  }
  // Filters: any control with data-f="key" stores its value in U.state[key] and re-renders.
  function onFilter(e) {
    var t = e.target;
    if (t.closest && t.closest('#s360-modal')) return;
    if (!t.getAttribute('data-f') && t.closest && t.closest('#s360-main form')) { var dk = keyFor(t); if (dk) dirty[dk] = (t.type === 'checkbox' || t.type === 'radio') ? t.checked : t.value; }
    if (t.id === 's360-q') { if (e.type === 'input') { ui.q = t.value; ui.pop = 'search'; render(); } return; }
    var k = t.getAttribute && t.getAttribute('data-f');
    if (!k) return;
    var isText = t.tagName === 'INPUT' && /text|search|number/.test(t.type);
    if (isText ? e.type !== 'input' : e.type !== 'change') return;
    U.state[k] = t.type === 'checkbox' ? t.checked : t.value;
    render();
  }
  function onKey(e) {
    if (document.getElementById('s360-modal')) return;
    if (e.key === 'Escape' && (ui.pop || ui.drawer)) { ui.pop = null; ui.drawer = false; ui.q = ''; render(); }
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); ui.pop = 'search'; render(); var q = $('#s360-q'); if (q) q.focus(); }
  }

  // Shared actions used from several screens
  U.actions['leave-decide'] = function (p) {
    if (!St.can('leave')) { U.toast('Leave approvals are on Premium'); return; }
    var l = St.leaves().filter(function (x) { return x.id === p[0]; })[0], who = St.person(l.staff);
    if (p[1] === 'Rejected') { U.rejectLeave(l); return; }
    St.decideLeave(p[0], p[1]); U.toast('Approved leave for ' + who.name);
  };
  U.rejectLeave = function (l) {
    var who = St.person(l.staff);
    U.modal({ title: 'Reject leave for ' + esc(who.name) + '?', submit: 'Reject leave',
      body: '<p class="muted" style="margin-bottom:10px">' + esc(l.type) + ' · ' + U.dLabel(l.from) + (l.to !== l.from ? ' – ' + U.dLabel(l.to) : '') + '</p>' +
        U.field('Reason (shared with ' + esc(who.name.split(' ')[0]) + ')', '<textarea name="note" id="m-rn" rows="2" maxlength="200" placeholder="e.g. Two people are already off that day"></textarea>', { for: 'note', req: true }),
      foot: '<button type="button" class="btn" data-m="close">Cancel</button><button type="submit" class="btn danger">Reject leave</button>',
      onSubmit: function (f) {
        var n = U.val(f, 'note'); if (!U.setErr(f, 'note', n.length < 3 ? 'Add a short reason' : '')) return;
        U.closeModal(); St.decideLeave(l.id, 'Rejected', null, n); U.toast('Rejected leave for ' + who.name);
      } });
  };

  function start() {
    root = document.getElementById('s360v2');
    St.subscribe(render);
    document.addEventListener('click', onClick);
    document.addEventListener('input', onFilter);
    document.addEventListener('change', onFilter);
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', route);
    setInterval(function () { var c = $('#s360-clock'); if (c) c.textContent = U.dLabel(St.today) + ', ' + U.t12(new Date().getHours() * 60 + new Date().getMinutes()); }, 30000);
    route();
  }
  U.startOwner = start;
  if (!window.S360_DEFER) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start(); }
})();
