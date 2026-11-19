/* Staff360 v2 — employee portal (mobile-first). Shows only the logged-in employee's own records. */
(function () {
  'use strict';
  var St = window.S360Store, U = window.S360UI, esc = U.esc, ic = U.ic;
  var KEY = 's360v2.emp', DEMO_OTP = '123456';
  var E = { route: 'login', mobile: '', gpsSim: 'ok', sheet: null, resendAt: 0, calMonth: '' };
  function me() { if (St.live) return St.staff({ all: true })[0] || null; var id; try { id = localStorage.getItem(KEY); } catch (e) { id = null; } var p = id && St.person(id); return p && p.status === 'Active' ? p : null; }
  function setMe(id) { try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }
  var root;

  function shell(body, tabs) {
    var p = me();
    return '<div class="emp">' + (tabs ? '<header class="emp-top">' + (window.S360_BACK ? '<button class="icon-btn" data-e="logout" aria-label="Back to HisaabNow">' + ic('left') + '</button>' : '') + '<div class="logo sm">' + U.LOGO + '<span>HisaabNow<small>Staff360</small></span></div>' + (St.live ? '<span class="muted small">' + esc(St.business.name) + '</span>' : '<span class="sample">Sample data</span>') + '</header>' : '') +
      '<main class="emp-main" id="emp-main">' + body + '</main>' +
      (tabs ? '<nav class="emp-tabs" aria-label="Employee">' + [['home', 'Home', 'home'], ['attendance', 'Attendance', 'cal'], ['leave', 'Leave', 'leave'], ['profile', 'Profile', 'user']].filter(function (t) { return t[0] !== 'leave' || (St.settings().perms.requestLeave && St.can('leave')); }).map(function (t) {
        return '<a href="#/' + t[0] + '" class="' + (E.route === t[0] ? 'on' : '') + '"' + (E.route === t[0] ? ' aria-current="page"' : '') + '>' + ic(t[2]) + '<span>' + t[1] + '</span></a>';
      }).join('') + '</nav>' : '') + (E.sheet ? E.sheet : '') + '</div>';
  }

  // ---------- login ----------
  function login() {
    var gated = !St.can('employee_portal');
    var demo = St.staff().filter(function (p) { return p.login; });
    var notIn = demo.filter(function (p) { var r = St.record(p.id, St.today); return (!r || r.status === 'notin') && p.weeklyOff !== U.parse(St.today).getDay(); });
    var hints = (notIn.slice(0, 2).concat(demo.filter(function (p) { return notIn.indexOf(p) < 0; }).slice(0, 1)));
    return '<div class="emp-auth"><div class="logo">' + U.LOGO + '<span>HisaabNow<small>Staff360</small></span></div>' +
      '<h1>Log in to check in</h1><p class="muted">Use the mobile number your employer added for you.</p>' +
      (gated ? '<div class="warn">' + ic('lock') + '<span><b>Staff login is a Premium feature.</b> Your employer’s plan (demo: ' + St.PLAN_LABEL[St.plan] + ') doesn’t include it yet. Ask them to upgrade, or switch the demo plan from the owner screens.</span></div>' : '') +
      '<form id="emp-login" novalidate>' + U.field('Mobile number', '<div class="phone-in"><span>+91</span><input id="e-mobile" name="mobile" inputmode="numeric" autocomplete="tel" maxlength="10" placeholder="98765 43210" value="' + esc(E.mobile) + '"' + (gated ? ' disabled' : '') + '></div>', { for: 'mobile' }) +
      '<button class="btn pri block" type="submit"' + (gated ? ' disabled' : '') + '>Send OTP</button></form>' +
      (gated ? '' : '<div class="demo-box"><b>Demo staff logins</b>' + hints.map(function (p) { var r = St.record(p.id, St.today); return '<button class="chip" data-e="fill:' + p.mobile + '">' + esc(p.name) + ' <small>' + U.mobile(p.mobile) + (U.isIn(r) && !r.out ? ' · checked in' : '') + '</small></button>'; }).join('') + '</div>') +
      '<p class="muted small center"><a href="index.html">Owner? Go to the owner dashboard</a></p></div>';
  }
  function otp() {
    var left = Math.max(0, Math.ceil((E.resendAt - Date.now()) / 1000));
    return '<div class="emp-auth"><button class="icon-btn" data-e="back" aria-label="Back">' + ic('left') + '</button><h1>Enter the OTP</h1><p class="muted">Sent to +91 ' + U.mobile(E.mobile) + '</p>' +
      '<div class="demo-otp">' + ic('alert') + '<span><b>Demo only:</b> no SMS is sent. Use OTP <b>' + DEMO_OTP + '</b>.</span></div>' +
      '<form id="emp-otp" novalidate>' + U.field('6-digit OTP', '<input id="e-otp" name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="otp-in" placeholder="••••••">', { for: 'otp' }) +
      '<button class="btn pri block" type="submit">Verify and log in</button></form>' +
      '<p class="center small">' + (left ? '<span class="muted" id="e-resend">Resend OTP in ' + left + 's</span>' : '<button class="link" data-e="resend">Resend OTP</button>') + '</p></div>';
  }

  // ---------- home ----------
  function home() {
    if (St.live && !St.can('employee_portal')) return '<section class="card emp-punch"><span class="big-ic mid">' + ic('lock') + '</span><h2 style="margin:10px 0 4px;color:var(--heading)">Check-in isn’t switched on yet</h2><p class="muted">Your employer’s Staff360 plan doesn’t include staff check-in. They can upgrade to Premium.</p></section><button class="btn block" data-e="logout">' + ic('logout') + 'Log out</button>';
    var p = me(), sh = St.shift(p.shift), r = St.record(p.id, St.today), off = p.weeklyOff != null && p.weeklyOff === U.parse(St.today).getDay();
    var hr = new Date().getHours(), greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    var h = '<section class="emp-hello"><small>' + greet + ',</small><h1>' + esc(p.name) + '</h1><p>' + esc(St.business.name) + ' · ' + U.dLabel(St.today, true) + '</p></section>';
    h += '<section class="card emp-shift"><div><small>Today’s shift</small><b>' + (sh ? esc(sh.name) + ' · ' + U.hm12(sh.start) + ' – ' + U.hm12(sh.end) : 'No shift assigned') + '</b>' + (sh ? '<small>' + sh.graceMin + ' min grace · weekly off: ' + U.offLabel(p) + '</small>' : '') + '</div>' + U.badge(r ? r.status : (off ? 'weeklyoff' : null)) + '</section>';
    var state = !r || r.status === 'notin' || r.status === 'absent' || ((r.status === 'present' || r.status === 'late' || r.status === 'halfday') && !r.in) ? 'out' : U.isIn(r) && !r.out ? 'in' : U.isIn(r) ? 'done' : r.status;
    var oy = St.live && St.extra.openYesterday;
    if (oy && state === 'out') h += '<section class="card"><p><b>You’re still checked in from yesterday</b> (in at ' + U.hm12(oy.inHm) + '). Check out to close that day.</p><button class="punch out" data-e="punch:out">' + ic('logout') + 'Check out from yesterday</button></section>';
    if (off && state === 'out') state = 'weeklyoff';
    h += '<section class="card emp-punch">';
    if (state === 'out') {
      var fz = St.live && St.extra.fence;
      h += '<p class="muted">You haven’t checked in today.</p><button class="punch in" data-e="punch:in">' + ic('login') + 'Check in</button><p class="gps-note">' + ic('pin') + (St.settings().rules.gpsRequired ? 'Your location is captured only when you tap — never in the background.' : 'Location isn’t needed by your employer.') + '</p>' +
        (fz && fz.mode === 'block' ? '<p class="gps-note">You need to be within ' + fz.radiusM + ' m of the shop.</p>' : '');
    } else if (state === 'in') {
      var mins = Math.max(0, (new Date().getHours() * 60 + new Date().getMinutes()) - U.toMin(r.in));
      h += '<div class="punch-info"><div><small>Checked in</small><b>' + U.hm12(r.in) + '</b>' + (r.status === 'late' ? '<span class="badge b-amber">Late ' + U.lateMin(r) + ' min</span>' : '<span class="badge b-green">On time</span>') + '</div><div><small>Time at work</small><b id="e-elapsed">' + U.dur(mins) + '</b></div></div>' +
        (r.gps ? '<p class="gps-ok">' + ic('pin') + 'Location captured · ±' + r.gps.acc + ' m' + (r.gps.low ? ' (low accuracy)' : '') + (r.gps.outside ? ' · away from the shop' : '') + '</p>' : r.gps === false ? '<p class="gps-note">' + ic('pin') + 'Checked in without location (marked “No GPS”)</p>' : '') +
        '<button class="punch out" data-e="punch:out">' + ic('logout') + 'Check out</button>';
    } else if (state === 'done') {
      h += '<div class="punch-info"><div><small>In</small><b>' + U.hm12(r.in) + '</b></div><div><small>Out</small><b>' + U.hm12(r.out) + '</b></div><div><small>Worked</small><b>' + U.dur(U.worked(r)) + '</b></div></div><p class="gps-ok">' + ic('check') + 'You’re done for today. See you tomorrow!</p>';
    } else if (state === 'weeklyoff') {
      h += '<p class="center"><b>Today is your weekly off.</b><br><span class="muted">Enjoy your day.</span></p>';
    } else if (state === 'leave') {
      h += '<p class="center"><b>You’re on approved leave today.</b></p>';
    } else {
      h += '<p class="center">Today: ' + U.badge(r.status) + '</p>';
    }
    h += '</section>';
    var recs = St.range(U.monthStart(St.today), St.today).filter(function (x) { return x.staff === p.id; }), c = U.count(recs);
    h += '<section class="card"><div class="card-h"><h2>' + U.monthLabel(St.today.slice(0, 7)) + '</h2><a href="#/attendance">My attendance</a></div><div class="emp-stats">' +
      [['Present', c.present, 'var(--success)'], ['Late', c.late, 'var(--warning)'], ['Half day', c.halfday, 'var(--orange)'], ['Absent', c.absent, 'var(--danger)'], ['Leave', c.leave, 'var(--purple)']].map(function (s) { return '<div><b style="color:' + s[2] + '">' + s[1] + '</b><small>' + s[0] + '</small></div>'; }).join('') + '</div></section>';
    h += '<p class="privacy">' + ic('shield') + 'You can see only your own attendance. No selfies, face scans or fingerprints.</p>';
    return h;
  }

  // ---------- my attendance ----------
  function attendance() {
    if (!E.calMonth || E.calMonth > St.today.slice(0, 7)) E.calMonth = St.today.slice(0, 7);
    var p = me(), ym = E.calMonth, y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1, first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
    var recs = St.range(ym + '-01', ym + '-31').filter(function (x) { return x.staff === p.id; }), c = U.count(recs);
    var h = '<div class="emp-h"><h1>My attendance</h1><div class="date-nav"><button class="icon-btn sm" data-e="cal:-1" aria-label="Previous month">' + ic('left') + '</button><b class="mlabel">' + U.monthLabel(ym) + '</b><button class="icon-btn sm" data-e="cal:1" aria-label="Next month"' + (ym >= St.today.slice(0, 7) ? ' disabled' : '') + '>' + ic('right') + '</button></div></div>';
    h += '<section class="card"><div class="emp-stats">' + [['Present', c.present, 'var(--success)'], ['Late', c.late, 'var(--warning)'], ['Half day', c.halfday, 'var(--orange)'], ['Absent', c.absent, 'var(--danger)']].map(function (s) { return '<div><b style="color:' + s[2] + '">' + s[1] + '</b><small>' + s[0] + '</small></div>'; }).join('') + '</div>';
    h += '<div class="mini-cal" role="grid" aria-label="' + U.monthLabel(ym) + '">' + U.DOW.map(function (d) { return '<span class="mh">' + d.charAt(0) + '</span>'; }).join('');
    for (var i = 0; i < first.getDay(); i++) h += '<span></span>';
    for (var d = 1; d <= days; d++) {
      var iso = ym + '-' + U.pad(d), r = St.record(p.id, iso), s = r ? U.STATUS[r.status] : null;
      h += '<span class="md' + (iso === St.today ? ' today' : '') + '" title="' + U.dLabel(iso, true) + ': ' + (s ? s[0] : iso > St.today ? 'Upcoming' : 'No record') + '"><b>' + d + '</b><i style="background:' + (s ? s[1] : 'transparent') + '"></i></span>';
    }
    h += '</div><div class="legend">' + ['present', 'late', 'halfday', 'absent', 'leave', 'weeklyoff'].map(function (k) { return '<span><i style="background:' + U.STATUS[k][1] + '"></i>' + U.STATUS[k][0] + '</span>'; }).join('') + '</div></section>';
    var list = recs.filter(function (x) { return x.status !== 'weeklyoff'; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var canFix = St.can('leave');
    var mine = St.corrections().filter(function (c) { return c.staff === p.id; });
    if (mine.length) h += '<section class="card"><div class="card-h"><h2>My correction requests</h2></div><ul class="list">' + mine.map(function (c) {
      var w = c.want || {};
      return '<li><span class="grow"><b>' + U.dLabel(c.date, true) + '</b><small>' + esc([w.status ? St.LABEL[w.status] : '', w.in ? 'In ' + U.hm12(w.in) : '', w.out ? 'Out ' + U.hm12(w.out) : ''].filter(Boolean).join(' · ')) + (c.note ? ' · ' + esc(c.note) : '') + '</small></span>' + U.leaveBadge(c.status) + '</li>';
    }).join('') + '</ul></section>';
    h += '<section class="card"><div class="card-h"><h2>Check-in history</h2>' + (canFix ? '<button class="btn sm" data-e="fix:' + St.today + '">Fix a day</button>' : '') + '</div>' + (list.length ? '<ul class="list">' + list.map(function (x) {
      return '<li><span class="grow"><b>' + U.dLabel(x.date, true) + '</b><small>' + (U.isIn(x) ? 'In ' + U.hm12(x.in) + ' · Out ' + U.hm12(x.out) + (U.worked(x) ? ' · ' + U.dur(U.worked(x)) : '') : esc(x.remark || '')) + '</small></span>' + U.badge(x.status) +
        (canFix ? '<button class="link small" data-e="fix:' + x.date + '" aria-label="Ask to fix ' + U.dLabel(x.date, true) + '">Fix</button>' : '') + '</li>';
    }).join('') + '</ul>' : '<div class="empty">No attendance this month.</div>') + '</section>';
    return h;
  }

  // ---------- my leave ----------
  function leave() {
    var p = me(), ls = St.leaves().filter(function (l) { return l.staff === p.id; });
    return '<div class="emp-h"><h1>My leave</h1><button class="btn pri sm" data-e="leave-new">' + ic('plus') + 'Request leave</button></div>' +
      '<section class="card">' + (ls.length ? '<ul class="list">' + ls.map(function (l) {
        return '<li><span class="grow"><b>' + l.type + ' leave · ' + l.days + ' day' + (l.days > 1 ? 's' : '') + '</b><small>' + U.dLabel(l.from, true) + (l.to !== l.from ? ' – ' + U.dLabel(l.to, true) : '') + ' · ' + esc(l.reason) + '</small></span>' + U.leaveBadge(l.status) + '</li>';
      }).join('') + '</ul>' : '<div class="empty">' + ic('leave') + '<br>You haven’t requested any leave yet.</div>') + '</section>';
  }

  // ---------- my profile ----------
  function profile() {
    var p = me(), sh = St.shift(p.shift);
    var head = '<div class="emp-h"><h1>My profile</h1></div><section class="card emp-prof">' + U.avatar(p, 56) + '<div><b>' + esc(p.name) + '</b><small>' + esc(p.designation) + (St.live ? '' : ' · ' + U.code(p)) + '</small></div></section>' +
      '<section class="card"><dl class="dl"><dt>Mobile</dt><dd>+91 ' + U.mobile(p.mobile) + '</dd><dt>Business</dt><dd>' + esc(St.business.name) + '</dd>' + (p.joined ? '<dt>Joined</dt><dd>' + U.joinLabel(p, true) + '</dd>' : '') + '<dt>Shift</dt><dd>' + (sh ? esc(sh.name) + ' · ' + U.hm12(sh.start) + '–' + U.hm12(sh.end) : '—') + '</dd><dt>Weekly off</dt><dd>' + U.offLabel(p) + '</dd></dl>' +
      '<p class="muted small">To change these, ask your employer.</p></section>';
    if (St.live) return head + '<p class="privacy">' + ic('shield') + 'You can see only your own attendance and leave.</p><button class="btn block danger-o" data-e="logout">' + ic(window.S360_BACK ? 'left' : 'logout') + (window.S360_BACK ? 'Back to HisaabNow' : 'Log out') + '</button>';
    return head +
      '<form class="card" id="emp-prof" novalidate><div class="card-h"><h2>Details you can edit</h2></div>' +
      U.field('Email (optional)', '<input id="e-email" name="email" type="email" value="' + esc(p.email || '') + '" maxlength="80">', { for: 'email' }) +
      U.field('Emergency contact (name and number)', '<input id="e-emer" name="emergency" value="' + esc(p.emergency || '') + '" maxlength="60" placeholder="e.g. Ramesh (brother) 98xxxxxxxx">', { for: 'emergency' }) +
      '<button class="btn pri block" type="submit">Save</button></form>' +
      '<button class="btn block danger-o" data-e="logout">' + ic('logout') + 'Log out</button>';
  }

  // ---------- ask for an attendance correction ----------
  function fixForm(date) {
    var p = me(), r = St.record(p.id, date);
    U.modal({
      title: 'Ask to fix a day', submit: 'Send request',
      body: '<p class="muted small" style="margin-bottom:10px">Your employer will check and approve it. ' + (r ? 'Recorded now: <b>' + St.LABEL[r.status] + (r.in ? ' · in ' + U.hm12(r.in) : '') + (r.out ? ' · out ' + U.hm12(r.out) : '') + '</b>' : 'Nothing is recorded for this day.') + '</p>' +
        U.field('Date', '<input name="date" id="m-fd" type="date" value="' + date + '" max="' + St.today + '" min="' + U.addDays(St.today, -31) + '">', { for: 'date', req: true }) +
        U.field('It should be', '<select name="status" id="m-fs">' + U.options([['', 'Keep the status'], ['present', 'Present'], ['halfday', 'Half day'], ['leave', 'On leave']], '') + '</select>', { for: 'status' }) +
        '<div class="grid2">' + U.field('Correct check-in', '<input name="in" id="m-fi" type="time" value="' + ((r && r.in) || '') + '">', { for: 'in' }) + U.field('Correct check-out', '<input name="out" id="m-fo" type="time" value="' + ((r && r.out) || '') + '">', { for: 'out' }) + '</div>' +
        U.field('What happened?', '<textarea name="reason" id="m-fr" rows="2" maxlength="200" placeholder="e.g. Forgot to check out, left at 7 pm"></textarea>', { for: 'reason', req: true }),
      onSubmit: function (f) {
        var d = U.val(f, 'date'), st = U.val(f, 'status'), tin = U.val(f, 'in'), tout = U.val(f, 'out'), why = U.val(f, 'reason'), ok = true;
        var same = r && (!st || st === r.status) && (tin || '') === (r.in || '') && (tout || '') === (r.out || '');
        ok = U.setErr(f, 'date', !d || d > St.today ? 'Pick today or an earlier day' : '') && ok;
        ok = U.setErr(f, 'out', tin && tout && tout <= tin ? 'Check-out must be after check-in' : !st && !tin && !tout ? 'Say what should change' : same ? 'Change at least one thing' : '') && ok;
        ok = U.setErr(f, 'reason', why.length < 3 ? 'Add a short reason' : '') && ok;
        if (!ok) return;
        var want = { status: st, in: tin && (!r || tin !== r.in) ? tin : '', out: tout && (!r || tout !== r.out) ? tout : '' };
        St.addCorrection({ staff: p.id, date: d, want: want, reason: why }, p.name + ' (employee)'); U.closeModal(); U.toast('Request sent to your employer');
      },
    });
  }

  // ---------- GPS simulation sheet ----------
  function gpsSheet(stage) {
    var allowNo = St.settings().rules.allowNoGps, need = St.settings().rules.gpsRequired && St.can('gps');
    var sim = St.live ? '' : '<div class="sim"><small>Demo: simulate location result</small><div class="seg">' + [['ok', 'Success'], ['weak', 'Weak signal'], ['off', 'Location off']].map(function (o) { return '<button data-e="sim:' + o[0] + '" class="' + (E.gpsSim === o[0] ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div></div>';
    var body;
    if (stage === 'locating') body = '<div class="spinner" aria-hidden="true"></div><h2>Getting your location…</h2><p class="muted">' + (St.live ? 'Only this one reading is saved with your check-' + E.kind + '.' : 'Simulated — this preview doesn’t use your real location.') + '</p>';
    else if (stage === 'sending') body = '<div class="spinner" aria-hidden="true"></div><h2>Saving your check-' + E.kind + '…</h2>';
    else if (stage === 'ok' || stage === 'weak') {
      var acc = St.live && E.gps ? Math.round(E.gps.accuracy) : stage === 'ok' ? 15 : 85;
      body = '<span class="big-ic ' + (stage === 'ok' ? 'good' : 'mid') + '">' + ic('pin') + '</span><h2>Location captured</h2><p class="muted">Accuracy ±' + acc + ' m' + (stage === 'weak' ? ' — weak signal, still recorded' : '') + '</p><button class="btn pri block" data-e="confirm:' + acc + '">Confirm check-' + E.kind + '</button>';
    } else {
      body = '<span class="big-ic bad">' + ic('pin') + '</span><h2>' + (St.live && E.gpsErr === 'denied' ? 'Location permission is blocked' : St.live && E.gpsErr === 'timeout' ? 'Couldn’t get your location' : 'Location is off') + '</h2>' + (St.live && E.gpsErr === 'denied' ? '<p class="muted small">Allow location for this site in your browser settings, then try again.</p>' : '') + (allowNo || !need ? '<p class="muted">You can still check ' + E.kind + '. Your employer will see it marked “No GPS”.</p><button class="btn pri block" data-e="confirm:0">Check ' + E.kind + ' without location</button>' : '<p class="muted">Your employer requires location. Turn on location and try again.</p><button class="btn block" data-e="retry">Try again</button>');
    }
    return '<div class="sheet-bg" data-e="sheet-close"><div class="sheet" role="dialog" aria-modal="true" aria-label="Location check">' + body + sim + '<button class="link" data-e="sheet-close">Cancel</button></div></div>';
  }

  // ---------- render / route ----------
  function render() {
    var p = me();
    if (!p && E.route !== 'login' && E.route !== 'otp') E.route = 'login';
    if (p && (E.route === 'login' || E.route === 'otp')) E.route = 'home';
    var body = { login: login, otp: otp, home: home, attendance: attendance, leave: leave, profile: profile }[E.route] || home;
    root.innerHTML = shell(body(), !!p);
  }
  function route() { E.route = location.hash.replace(/^#\/?/, '') || 'home'; E.sheet = null; render(); window.scrollTo(0, 0); if (E.focusOtp) { E.focusOtp = false; var o = document.getElementById('e-otp'); if (o) o.focus(); } }

  function livePunch(kind) {
    var rules = St.settings().rules;
    E.gps = null; E.gpsErr = null; E.sheet = gpsSheet('locating'); render();
    if (!navigator.geolocation) { E.gpsErr = 'unsupported'; E.sheet = gpsSheet('off'); render(); return; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      if (!E.sheet) return;
      E.gps = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, capturedAt: pos.timestamp || Date.now() };
      E.sheet = gpsSheet(rules.minAccuracyM && E.gps.accuracy > rules.minAccuracyM ? 'weak' : 'ok'); render();
      var b = document.querySelector('.sheet .btn'); if (b) b.focus();
    }, function (err) {
      if (!E.sheet) return;
      E.gpsErr = err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable'; E.sheet = gpsSheet('off'); render();
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }
  function liveSend(withGps) {
    E.sheet = gpsSheet('sending'); render();
    St.backend().punch(E.kind, withGps ? E.gps : null, withGps ? null : (E.gpsErr || 'unavailable')).then(function (r) {
      E.sheet = null; render(); St.backend().reload(); U.toast((E.kind === 'in' ? 'Checked in at ' : 'Checked out at ') + U.hm12(E.kind === 'in' ? r.punch.inHm : r.punch.outHm));
    }, function (e) {
      var msg = String(e.message || ''), map = { already_checked_in: 'You’re already checked in today.', already_completed: 'You’ve already checked out today.', no_open_checkin: 'There’s no check-in to close.' };
      var k = Object.keys(map).filter(function (x) { return msg.indexOf(x) >= 0; })[0];
      var far = /outside_radius:(\d+)/.exec(msg);
      E.sheet = null; render(); U.toast(k ? map[k] : far ? 'You’re about ' + (far[1] >= 1000 ? (Math.round(far[1] / 100) / 10) + ' km' : far[1] + ' m') + ' from the shop. Check in when you’re there.' : /gps_required/.test(msg) ? 'Your employer needs your location to check you in.' : (e.userMessage || 'Couldn’t save. Try again.'));
      St.backend().reload();
    });
  }
  function startPunch(kind) {
    E.kind = kind;
    if (St.live) { livePunch(kind); return; }
    if (!(St.settings().rules.gpsRequired && St.can('gps'))) { finishPunch(null); return; }
    E.sheet = gpsSheet('locating'); render();
    setTimeout(function () { if (!E.sheet) return; E.sheet = gpsSheet(E.gpsSim); render(); var b = document.querySelector('.sheet .btn'); if (b) b.focus(); }, 900);
  }
  function finishPunch(acc) {
    var p = me(), t = St.punch(p.id, E.kind, acc === null ? undefined : acc ? { acc: acc } : false);
    E.sheet = null; render(); U.toast((E.kind === 'in' ? 'Checked in at ' : 'Checked out at ') + U.hm12(t));
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-e]'); if (!t) return;
    var a = t.getAttribute('data-e').split(':');
    if (a[0] === 'sheet-close' && t !== e.target && t.classList.contains('sheet-bg') && e.target.closest('.sheet')) return;
    e.preventDefault();
    if (a[0] === 'fill') { E.mobile = a[1]; render(); var i = document.getElementById('e-mobile'); if (i) i.focus(); }
    if (a[0] === 'back') { E.route = 'login'; location.hash = '#/login'; }
    if (a[0] === 'resend') { E.resendAt = Date.now() + 30000; render(); U.toast('Demo: OTP “resent” (no SMS). Use ' + DEMO_OTP); }
    if (a[0] === 'punch') startPunch(a[1]);
    if (a[0] === 'sim') { E.gpsSim = a[1]; E.sheet = gpsSheet(a[1]); render(); }
    if (a[0] === 'confirm') { if (St.live) liveSend(+a[1] > 0); else finishPunch(+a[1]); }
    if (a[0] === 'retry') startPunch(E.kind);
    if (a[0] === 'sheet-close') { E.sheet = null; render(); }
    if (a[0] === 'cal') { var d = U.parse(E.calMonth + '-01'); d.setMonth(d.getMonth() + (+a[1])); var ym = U.iso(d).slice(0, 7); if (ym <= St.today.slice(0, 7)) { E.calMonth = ym; render(); } }
    if (a[0] === 'fix') fixForm(a[1]);
    if (a[0] === 'leave-new') U.leaveForm({ staff: me().id, by: me().name + ' (employee)', title: 'Request leave' });
    if (a[0] === 'logout' && St.live) { St.backend().signOut(); return; }
    if (a[0] === 'logout') { setMe(null); E.mobile = ''; location.hash = '#/login'; render(); U.toast('Logged out'); }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target; e.preventDefault();
    if (f.id === 'emp-login') {
      var m = U.val(f, 'mobile').replace(/\D/g, ''); E.mobile = m;
      var p = St.byMobile(m);
      if (!/^[6-9]\d{9}$/.test(m)) { U.setErr(f, 'mobile', 'Enter your 10-digit mobile number'); return; }
      if (!p || p.status !== 'Active') { U.setErr(f, 'mobile', 'This number isn’t registered. Ask your employer to add you.'); return; }
      if (!p.login) { U.setErr(f, 'mobile', 'Staff login isn’t turned on for you yet. Ask your employer.'); return; }
      E.resendAt = Date.now() + 30000; E.focusOtp = true; location.hash = '#/otp';
    }
    if (f.id === 'emp-otp') {
      var code = U.val(f, 'otp');
      if (code !== DEMO_OTP) { U.setErr(f, 'otp', code.length < 6 ? 'Enter all 6 digits' : 'That OTP is wrong. In this demo it’s ' + DEMO_OTP + '.'); return; }
      setMe(St.byMobile(E.mobile).id); if (location.hash === '#/home') route(); else location.hash = '#/home'; U.toast('Logged in');
    }
    if (f.id === 'emp-prof') {
      var email = U.val(f, 'email');
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { U.setErr(f, 'email', 'Enter a valid email'); return; }
      St.updateProfile(me().id, { email: email, emergency: U.val(f, 'emergency') }); U.toast('Profile saved');
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && E.sheet) { E.sheet = null; render(); } });
  setInterval(function () {
    var el = document.getElementById('e-elapsed'), p = me();
    if (el && p) { var r = St.record(p.id, St.today); if (r && r.in) el.textContent = U.dur(Math.max(0, new Date().getHours() * 60 + new Date().getMinutes() - U.toMin(r.in))); }
    var rs = document.getElementById('e-resend'); if (rs) { var left = Math.ceil((E.resendAt - Date.now()) / 1000); if (left <= 0) render(); else rs.textContent = 'Resend OTP in ' + left + 's'; }
  }, 1000);

  function start() { root = document.getElementById('s360emp'); St.subscribe(render); window.addEventListener('hashchange', route); route(); }
  window.S360Emp = { start: start };
  if (!window.S360_DEFER) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start(); }
})();
