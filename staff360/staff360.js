/* ═══════════════════════════════════════════════════════════════════
   HisaabNow Staff360 — client module (Nov 2026)
   ───────────────────────────────────────────────────────────────────
   Basic   = the existing Step ATT attendance (window.HNAttend), unchanged.
   Premium = employee GPS check-in/out, shifts, leave/corrections, detailed
             reports — locked until the server says the shop has it.
   King PRO= AI Staff Manager, assistant, alerts, salary draft, WhatsApp.

   SECURITY: this file only RENDERS. Plan, role and tenant checks happen in
   the staff360* Cloud Functions; nothing here (localStorage, URL, globals)
   can unlock a feature — the server re-checks every call.

   Loads after index.html. Shows only where Step ATT is eligible (salon for
   now). Kill switch: localStorage.setItem('HN_S360','off'); location.reload()
   No face recognition, selfies or biometrics anywhere — by product decision.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.Staff360) return;
  /* STANDALONE = running on hisaabnow.com/staff360/app (own login, no
     HisaabNow app around it). Staff, marks and reports then come from the
     server instead of the app's local store. Same screens, same server. */
  var SA = !!window.STAFF360_STANDALONE;

  /* ───────── tiny helpers ───────── */
  var $ = function (id) { return document.getElementById(id); };
  function off() { try { return localStorage.getItem('HN_S360') === 'off'; } catch (e) { return false; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoLocal(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayLocal() { return isoLocal(new Date()); }
  function addDays(s, n) { var p = s.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2] + n); return isoLocal(d); }
  function rs(n) { n = Math.round(Number(n) || 0); try { return '₹' + n.toLocaleString('en-IN'); } catch (e) { return '₹' + n; } }
  function hm(min) { min = Math.max(0, Math.round(Number(min) || 0)); return Math.floor(min / 60) + 'h ' + pad(min % 60) + 'm'; }
  function fmtDate(s) { try { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return s; } }
  function fmtTime(ms) { try { return new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function initials(n) { return String(n || '?').split(/\s+/).map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase(); }
  function track(name, params) { try { if (window.hnEvent) window.hnEvent(name, params || {}); } catch (e) {} }
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MARK_LABEL = { P: 'Present', H: 'Half-day', A: 'Absent', L: 'Leave', W: 'Week off' };

  function toast(msg) {
    try { if (window.App && App.toast && !$('s360') && !$('s360e')) { App.toast(msg); return; } } catch (e) {}
    var t = document.createElement('div'); t.className = 's360-toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { try { t.remove(); } catch (e) {} }, 3200);
  }
  function confirmBox(o) {
    try { if (window.App && typeof App.confirm === 'function') return Promise.resolve(App.confirm(o)); } catch (e) {}
    return Promise.resolve(window.confirm(o.title + (o.message ? '\n\n' + o.message : '')));
  }

  /* ───────── existing app bridges (read-only) ───────── */
  function role() { try { return document.documentElement.getAttribute('data-current-role') || 'owner'; } catch (e) { return 'owner'; } }
  function isManager() { var r = role(); return r === 'owner' || r === 'manager'; }
  function activeShop() { try { return window.MShop && MShop.getActive ? MShop.getActive() : null; } catch (e) { return null; } }
  function shopId() { var a = activeShop(); return a && a.shopId || null; }
  function eligible() { if (off()) return false; if (SA) return true; try { return !!(window.HNAttend && HNAttend.eligible && HNAttend.eligible()); } catch (e) { return false; } }
  function staffLocal() {
    if (SA) {
      var rr = want('roster', function () { return call('staff360StaffRoster', {}); });
      return rr && rr.v ? rr.v.staff : [];
    }
    try { return (window.Store && Store.list && Store.list('staff') || []).filter(function (s) { return s && s.id && !s._deleted && !s.deletedAt; }); } catch (e) { return []; }
  }
  function markLocal(sid, date) {
    if (SA) {
      var rg = want('reg:' + date, function () { return call('staff360Register', { date: date }); });
      var row = rg && rg.v ? rg.v.rows.filter(function (x) { return x.staffId === sid; })[0] : null;
      return row ? { m: row.status || '', i: row.inHm || '', o: row.outHm || '' } : {};
    }
    try {
      var d = Store.get('agents', 'att_' + sid + '_' + date.slice(0, 7));
      var r = d && !d._deleted && d.days ? d.days[date] : null;
      if (!r) { var s = Store.get('staff', sid); r = s && s.att ? s.att[date] : null; }
      return r && typeof r === 'object' ? r : {};
    } catch (e) { return {}; }
  }

  /* ───────── server calls ───────── */
  function mkErr(code, msg) { var e = new Error(msg); e.code = code; return e; }
  function call(name, data) {
    if (navigator.onLine === false) return Promise.reject(mkErr('offline', 'You are offline. Staff360 needs internet for this.'));
    if (!window.kfFunctions || !window.kfCallable) return Promise.reject(mkErr('not-ready', 'The app is still connecting. Try again in a moment.'));
    var sid = shopId();
    if (!sid) return Promise.reject(mkErr('no-shop', 'Open a shop first.'));
    var payload = Object.assign({ shopId: sid }, data || {});
    return window.kfCallable(window.kfFunctions, name)(payload).then(function (r) { return r && r.data; }, function (e) {
      var code = String(e && e.code || '').replace('functions/', '');
      var msg = String(e && e.message || 'Something went wrong');
      if ((code === 'not-found' && /^(not[-_ ]?found)$/i.test(msg)) || (code === 'internal' && /^internal$/i.test(msg))) {
        S.serverMissing = true;
        throw mkErr('server-missing', 'Staff360 server is not set up yet for this app.');
      }
      if (code === 'failed-precondition' && /^upgrade_required:/.test(msg)) throw mkErr('upgrade', msg.split(':')[1]);
      throw mkErr(code || 'error', msg);
    });
  }

  /* ───────── state ───────── */
  var S = { st: null, stAt: 0, stShop: null, stErr: null, serverMissing: false, skew: 0, view: 'overview', data: {}, busy: {}, chat: [], sub: {} };
  function plan() { return S.st && S.st.plan || 'basic'; }
  function has(f) { return !!(S.st && S.st.features && S.st.features[f]); }
  var NEED = { premium: 'Premium', kingpro: 'King PRO' };
  var RANK = { basic: 1, premium: 2, kingpro: 3 };

  function loadState(force) {
    var sid = shopId();
    if (!force && S.st && S.stShop === sid && Date.now() - S.stAt < 5 * 60e3) return Promise.resolve(S.st);
    return call('staff360GetState', {}).then(function (st) {
      S.st = st; S.stAt = Date.now(); S.stShop = sid; S.stErr = null; S.serverMissing = false;
      if (st && st.serverTime) S.skew = st.serverTime - Date.now();
      return st;
    }, function (e) { S.stErr = e; S.st = null; S.stShop = sid; S.stAt = Date.now(); return null; });
  }

  /* ═══════════════════ OWNER / MANAGER HUB ═══════════════════ */
  var VIEWS = [
    { id: 'overview', label: 'Overview', ic: '🏠' },
    { id: 'team', label: 'Team', ic: '👥' },
    { id: 'register', label: 'Register', ic: '🗓' },
    { id: 'shifts', label: 'Shifts', ic: '⏰', need: 'shifts' },
    { id: 'requests', label: 'Requests', ic: '📝', need: 'leave_requests' },
    { id: 'reports', label: 'Reports', ic: '📊' },
    { id: 'ai', label: 'AI Staff Manager', ic: '👑', need: 'ai_dashboard' },
    { id: 'whatsapp', label: 'WhatsApp reports', ic: '💬', need: 'whatsapp_reports', owner: true },
    { id: 'activity', label: 'Activity', ic: '🧾' },
    { id: 'plans', label: 'Plans', ic: '⭐' },
    { id: 'settings', label: 'Settings', ic: '⚙️', need: 'settings', owner: true },
    { id: 'mark', label: 'Mark attendance', ic: '✓', hidden: true },
  ];
  var FEATURE_NEED = { shifts: 'premium', leave_requests: 'premium', settings: 'premium', ai_dashboard: 'kingpro', whatsapp_reports: 'kingpro' };

  function open(view) {
    if (!eligible()) { toast('Staff360 is not available for this shop yet'); return; }
    if (!isManager()) { openEmployee(); return; }
    css();
    S.view = view || S.view || 'overview';
    var el = $('s360');
    if (!el) {
      el = document.createElement('div'); el.id = 's360'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Staff360');
      el.innerHTML = '<div class="s360-wrap"><div class="s360-hd">' + (SA ? '<button class="s360-x" data-a="menu" aria-label="Account menu">☰</button>' : '<button class="s360-x" data-a="close" aria-label="Close Staff360">←</button>') + '' +
        '<div class="s360-tt"><b>Staff360</b><small id="s360-sub">Smart staff &amp; workforce management</small></div><span id="s360-badge"></span></div>' +
        '<div class="s360-body"><nav class="s360-nav" id="s360-nav" aria-label="Staff360 sections"></nav><main class="s360-main" id="s360-main" tabindex="-1"></main></div></div>';
      el.addEventListener('click', onClick); el.addEventListener('change', onChange); el.addEventListener('input', onInput); el.addEventListener('submit', onSubmit);
      el.addEventListener('scroll', function () { var h = el.querySelector('.s360-hd'); if (h) h.classList.toggle('sh', el.scrollTop > 4); });
      document.body.appendChild(el);
      try { S._ov = document.body.style.overflow; document.body.style.overflow = 'hidden'; } catch (e) {}
    }
    track('staff360_opened', { plan: plan() });
    render();
    loadState(false).then(function () { pushRoster(false); render(); });
  }
  function close() {
    var el = $('s360'); if (el) el.remove();
    try { document.body.style.overflow = S._ov || ''; } catch (e) {}
  }
  function go(v) { S.view = v; render(); var m = $('s360-main'); if (m) { try { m.focus({ preventScroll: true }); } catch (e) {} } var el = $('s360'); if (el) el.scrollTop = 0; }

  function badgeHTML() {
    var p = plan();
    var label = p === 'kingpro' ? '👑 KING PRO' : p === 'premium' ? '✦ PREMIUM' : 'BASIC';
    var g = S.st && S.st.entitlement && S.st.entitlement.inGrace ? ' · renew' : '';
    return '<button class="s360-badge ' + p + '" data-a="go" data-v="plans" aria-label="Plan: ' + label + '. Manage plan">' + label + g + '</button>';
  }

  function render() {
    var el = $('s360'); if (!el) return;
    $('s360-badge').innerHTML = S.st || !S.stErr ? badgeHTML() : '<span class="s360-badge">BASIC</span>';
    var a = activeShop();
    $('s360-sub').textContent = (a && a.name ? a.name + ' · ' : '') + (role() === 'manager' ? 'Manager' : 'Owner');
    var isOwner = role() === 'owner';
    $('s360-nav').innerHTML = VIEWS.filter(function (v) { return (!v.owner || isOwner) && !v.hidden; }).map(function (v) {
      var locked = v.need && !has(v.need);
      var lk = locked ? '<span class="lk" aria-label="locked">' + (FEATURE_NEED[v.need] === 'kingpro' ? '👑🔒' : '🔒') + '</span>' : '';
      return '<button class="' + (S.view === v.id ? 'on' : '') + '" data-a="go" data-v="' + v.id + '"' + (S.view === v.id ? ' aria-current="page"' : '') + '><span aria-hidden="true">' + v.ic + '</span>' + esc(v.label) + lk + '</button>';
    }).join('');
    var m = $('s360-main');
    var v = VIEWS.filter(function (x) { return x.id === S.view; })[0] || VIEWS[0];
    var html = '';
    try {
      if (v.need && !has(v.need)) html = lockHTML(v.need);
      else html = (R[v.id] || R.overview)();
    } catch (e) { console.error('[Staff360] render', e); html = '<div class="s360-err">Could not show this screen. ' + esc(e.message) + '</div>'; }
    m.innerHTML = serverBanner() + html;
  }

  function serverBanner() {
    if (S.serverMissing || (S.stErr && S.stErr.code === 'server-missing')) {
      return '<div class="s360-warn" role="status"><b>Server setup pending.</b> Basic attendance works now. Premium and King PRO features need the Staff360 server functions to be deployed — they stay locked until then.</div>';
    }
    if (S.stErr && S.stErr.code === 'offline') return '<div class="s360-warn" role="status">You are offline. Showing what is saved on this device.</div>';
    if (S.stErr) return '<div class="s360-warn" role="status">Could not check your Staff360 plan (' + esc(S.stErr.message) + '). <button class="s360-lnk" data-a="retry">Retry</button></div>';
    return '';
  }

  var LOCK_COPY = {
    shifts: ['Shifts & weekly offs', 'premium', ['Create morning / evening / night shifts', 'Grace period for late marking', 'Weekly offs and staff assignment']],
    leave_requests: ['Leave & correction requests', 'premium', ['Staff request leave from their own phone', 'Approve or reject with a reason', 'Every decision goes into the audit log']],
    settings: ['GPS & attendance settings', 'premium', ['Business timezone', 'GPS policy and accuracy threshold']],
    ai_dashboard: ['AI Staff Manager', 'kingpro', ['Daily AI summary of attendance', 'Repeated late arrivals and missed punches, with evidence', 'Ask questions like “Who was absent today?”', 'Draft salary estimates for your approval', 'Tomorrow’s likely availability']],
    whatsapp_reports: ['WhatsApp attendance reports', 'kingpro', ['Daily or weekly summary on WhatsApp', 'Only after you opt in', 'Turn off any time']],
    history_detailed: ['GPS punches & working hours', 'premium', ['Employees check in / out from their own phone', 'Location captured only at check-in and check-out', 'Late arrivals, early leaves and hours worked']],
    report_detailed: ['Detailed reports & export', 'premium', ['Hours worked, late arrivals and missed check-outs', 'Export to CSV / Excel']],
  };
  function lockHTML(feature) {
    var c = LOCK_COPY[feature] || [feature, FEATURE_NEED[feature] || 'premium', []];
    var king = c[1] === 'kingpro';
    track('staff360_upgrade_viewed', { feature: feature });
    return '<div class="s360-lock ' + (king ? '' : 'prem') + '"><div style="font-size:28px" aria-hidden="true">' + (king ? '👑' : '🔒') + '</div><h3>' + esc(c[0]) + '</h3>' +
      '<div class="s360-note">Available on <b>' + (king ? 'King PRO · ₹4,999 / year' : 'Premium') + '</b>' + (king ? '' : ' and King PRO') + '.</div>' +
      (c[2].length ? '<ul>' + c[2].map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      '<button class="s360-btn ' + (king ? 'gold' : '') + '" data-a="go" data-v="plans">See plans</button></div>';
  }

  function loading() { return '<div class="s360-card" aria-busy="true"><div class="s360-skel" style="width:60%"></div><div class="s360-skel"></div><div class="s360-skel" style="width:80%"></div></div>'; }
  function errBox(e, key) {
    if (e && e.code === 'upgrade') return lockHTML(e.message === 'kingpro' ? 'ai_dashboard' : 'history_detailed');
    if (e && e.code === 'server-missing') return '<div class="s360-warn">This needs the Staff360 server, which is not deployed yet.</div>';
    return '<div class="s360-err" role="alert">' + esc(e && e.message || 'Something went wrong') + ' <button class="s360-lnk" data-a="reload" data-k="' + esc(key) + '">Retry</button></div>';
  }
  /* fetch-once-per-view cache */
  function want(key, fn) {
    var d = S.data[key];
    if (d) return d;
    if (!S.busy[key]) {
      S.busy[key] = true;
      Promise.resolve().then(fn).then(function (v) { S.data[key] = { v: v }; }, function (e) { S.data[key] = { e: e }; })
        .then(function () { S.busy[key] = false; render(); });
    }
    return null;
  }
  function invalidate(prefix) { Object.keys(S.data).forEach(function (k) { if (k.indexOf(prefix) === 0) delete S.data[k]; }); }

  /* ───────── views ───────── */
  var R = {};

  R.overview = function () {
    var t = todayLocal(), L = staffLocal().filter(function (s) { return s.active !== false; });
    var c = { P: 0, H: 0, A: 0, L: 0, W: 0, un: 0 };
    L.forEach(function (s) { var m = markLocal(s.id, t).m; if (c[m] != null) c[m]++; else c.un++; });
    var late = null;
    if (has('late_tracking')) {
      var reg = want('reg:' + t, function () { return call('staff360Register', { date: t }); });
      if (reg && reg.v) late = reg.v.rows.filter(function (r) { return r.lateMin > 0; }).length;
    }
    var h = '<div class="s360-h2">Today · ' + esc(fmtDate(t)) + '</div><div class="s360-stats">' +
      '<div class="s360-stat p"><span>Present</span><b>' + (c.P + c.H) + '</b></div>' +
      '<div class="s360-stat l"><span>Late</span><b>' + (late == null ? (has('late_tracking') ? '…' : '<span title="Premium">🔒</span>') : late) + '</b></div>' +
      '<div class="s360-stat a"><span>Absent / leave</span><b>' + (c.A + c.L) + '</b></div>' +
      '<div class="s360-stat"><span>Total staff</span><b>' + L.length + '</b></div></div>';
    h += '<div class="s360-acts" style="margin-bottom:14px"><button class="s360-btn" data-a="mark">✓ Mark attendance</button><button class="s360-btn sec" data-a="addstaff">+ Add staff</button>' +
      (has('leave_requests') ? '<button class="s360-btn sec" data-a="go" data-v="requests">Requests</button>' : '') +
      (S.st && S.st.me && !S.st.me.error && has('self_checkin') ? '<button class="s360-btn sec" data-a="myself">My check-in</button>' : '') + '</div>';
    h += '<div class="s360-split"><div><div class="s360-h2">Attendance today <button class="s360-lnk" data-a="go" data-v="register">View all ›</button></div><div class="s360-card">';
    if (!L.length) h += '<div class="s360-empty">No staff yet. Add your team to start marking attendance.</div>';
    else h += L.slice(0, 8).map(function (s) {
      var r = markLocal(s.id, t);
      return '<div class="s360-row"><div class="s360-av" aria-hidden="true">' + esc(initials(s.name)) + '</div><div class="s360-grow"><b>' + esc(s.name || 'Staff') + '</b><small>' + esc(s.role || '') + (r.i ? ' · In ' + esc(r.i) + (r.o ? ' → ' + esc(r.o) : '') : '') + '</small></div>' +
        (r.m ? '<span class="s360-chip ' + r.m + '">' + MARK_LABEL[r.m] + '</span>' : '<span class="s360-chip">Not marked</span>') + '</div>';
    }).join('');
    h += '</div></div><div>' + upgradeCard() + '</div></div>';
    return h;
  };

  function upgradeCard() {
    var p = plan();
    if (p === 'kingpro') return '<div class="s360-card king"><b>👑 AI Staff Manager</b><div class="s360-note">Summaries, patterns to review and salary drafts from your real attendance.</div><button class="s360-btn gold sm" data-a="go" data-v="ai">Open AI Staff Manager</button></div>';
    if (p === 'premium') return '<div class="s360-card king"><b>Make AI your staff manager</b><div class="s360-note">King PRO adds an attendance assistant, late-pattern alerts, salary drafts and WhatsApp summaries.</div><button class="s360-btn gold sm" data-a="go" data-v="plans">King PRO · ₹4,999/year</button></div>';
    return '<div class="s360-card soft"><b>Put attendance in your team’s hands</b><div class="s360-note">Premium lets staff check in from their own phone with GPS, adds shifts, late tracking, leave requests and detailed reports.</div><button class="s360-btn sm" data-a="go" data-v="plans">Compare plans</button></div>';
  }

  R.team = function () { return SA ? teamSA() : teamEmbedded(); };
  function teamEmbedded() {
    var q = (S.sub.q || '').toLowerCase(), f = S.sub.f || 'active', t = todayLocal();
    var L = staffLocal().filter(function (s) {
      var act = s.active !== false;
      if (f === 'active' && !act) return false; if (f === 'inactive' && act) return false;
      return !q || String(s.name || '').toLowerCase().indexOf(q) >= 0 || String(s.phone || s.phoneE164 || '').indexOf(q) >= 0;
    });
    var all = staffLocal().filter(function (s) { return s.active !== false; }).length;
    var lim = S.st && S.st.plans && S.st.plans[plan()] && S.st.plans[plan()].maxStaff;
    var h = '<div class="s360-h2">Staff <button class="s360-btn sm" data-a="addstaff">+ Add staff</button></div>' +
      '<div class="s360-grid2" style="margin-bottom:8px"><label><span class="s360-sr">Search staff</span><input class="s360-in" id="s360-q" placeholder="Search name or mobile" value="' + esc(S.sub.q || '') + '" data-a-input="q"></label>' +
      '<label><span class="s360-sr">Filter</span><select class="s360-sel" data-a-sel="f"><option value="active"' + (f === 'active' ? ' selected' : '') + '>Active</option><option value="inactive"' + (f === 'inactive' ? ' selected' : '') + '>Inactive</option><option value="all"' + (f === 'all' ? ' selected' : '') + '>All</option></select></label></div>' +
      '<div class="s360-note">' + all + (lim ? ' of ' + lim : '') + ' active staff' + (lim ? ' used on your plan' : '') + '</div><div class="s360-card">';
    if (!L.length) h += '<div class="s360-empty">' + (q ? 'No staff match “' + esc(S.sub.q) + '”.' : 'No staff here yet.') + '</div>';
    h += L.map(function (s) {
      var r = markLocal(s.id, t);
      var login = s.hasLogin ? '<span class="s360-chip P" title="Can sign in with own phone">Login</span>' : '';
      return '<div class="s360-row"><div class="s360-av" aria-hidden="true">' + esc(initials(s.name)) + '</div><div class="s360-grow"><b>' + esc(s.name || 'Staff') + '</b><small>' + esc(s.role || 'Staff') + ' · Today: ' + (r.m ? MARK_LABEL[r.m] : 'Not marked') + (s.active === false ? ' · Inactive' : '') + '</small></div>' + login +
        '<button class="s360-btn sec sm" data-a="editstaff" data-id="' + esc(s.id) + '" aria-label="Edit ' + esc(s.name) + '">Edit</button></div>';
    }).join('');
    h += '</div><div class="s360-note">Adding, editing and removing staff uses HisaabNow’s existing Staff screen, so logins and salaries stay in one place.' +
      (has('self_checkin') ? ' To let someone check in from their own phone, give them a role with login (e.g. Cashier or Manager) and their mobile number.' : '') + '</div>';
    return h;
  }

  function rosterInfo() { var r = S.data.roster; return r && r.v ? r.v : null; }
  function teamSA() {
    var res = want('roster', function () { return call('staff360StaffRoster', {}); });
    var h = '<div class="s360-h2">Staff <button class="s360-btn sm" data-a="addstaff">+ Add staff</button></div>';
    if (!res) return h + loading();
    if (res.e) { S.sub.pendingAdd = false; return h + errBox(res.e, 'roster'); }
    var v = res.v, q = (S.sub.q || '').toLowerCase(), f = S.sub.f || 'active', t = todayLocal();
    if (S.sub.pendingAdd) { S.sub.pendingAdd = false; setTimeout(function () { if (v.editable) staffSheet(null); else shopAddInfo(); }, 0); }
    var L = v.staff.filter(function (s) {
      if (f === 'active' && !s.active) return false; if (f === 'inactive' && s.active) return false;
      return !q || s.name.toLowerCase().indexOf(q) >= 0 || String(s.phone || '').indexOf(q) >= 0;
    });
    var act = v.staff.filter(function (s) { return s.active; }).length;
    h += '<div class="s360-grid2" style="margin-bottom:8px"><label><span class="s360-sr">Search staff</span><input class="s360-in" id="s360-q" placeholder="Search name or mobile" value="' + esc(S.sub.q || '') + '" data-a-input="q"></label>' +
      '<label><span class="s360-sr">Filter</span><select class="s360-sel" data-a-sel="f"><option value="active"' + (f === 'active' ? ' selected' : '') + '>Active</option><option value="inactive"' + (f === 'inactive' ? ' selected' : '') + '>Inactive</option><option value="all"' + (f === 'all' ? ' selected' : '') + '>All</option></select></label></div>' +
      '<div class="s360-note">' + act + (v.maxStaff ? ' of ' + v.maxStaff : '') + ' active staff' + (v.maxStaff ? ' on your plan' : '') + '</div><div class="s360-card">';
    if (!L.length) h += '<div class="s360-empty">' + (q ? 'No staff match “' + esc(S.sub.q) + '”.' : (v.editable ? 'No staff yet. Tap “+ Add staff” to add your team.' : 'No staff yet.')) + '</div>';
    h += L.map(function (s) {
      var r = markLocal(s.id, t);
      return '<div class="s360-row"><div class="s360-av" aria-hidden="true">' + esc(initials(s.name)) + '</div><div class="s360-grow"><b>' + esc(s.name) + '</b><small>' + esc(s.role || 'Staff') + (s.phone ? ' · ' + esc(s.phone) : '') + ' · Today: ' + (r.m ? MARK_LABEL[r.m] : 'Not marked') + (s.active ? '' : ' · Inactive') + '</small></div>' +
        (s.canLogin || s.hisaabnowLogin ? '<span class="s360-chip P" title="Can log in with own phone">Login</span>' : '') +
        (s.hisaabnowLogin ? '' : '<button class="s360-btn sec sm" data-a="editstaff" data-id="' + esc(s.id) + '" aria-label="Edit ' + esc(s.name) + '">Edit</button>') + '</div>';
    }).join('');
    h += '</div><div class="s360-note">' + (v.editable ? '' : 'This is a HisaabNow shop: add or rename staff in the HisaabNow app. Here you can give staff a Staff360 login. ') +
      'Staff with a login sign in at <b>hisaabnow.com/staff360/login</b> with their mobile number and OTP' + (has('self_checkin') ? ' to check in and out.' : '. Self check-in needs Premium.') + ' They only ever see their own attendance.</div>';
    return h;
  }

  /* HisaabNow shops keep their staff list in the HisaabNow app (it syncs here
     when the owner opens Staff360 in the app). Say so instead of failing. */
  function shopAddInfo() {
    var shop = (window.MShop && MShop.getActive && MShop.getActive().name) || 'This business';
    sheet('<h3>Add staff in the HisaabNow app</h3>' +
      '<p class="s360-note" style="font-size:14.5px;color:#182230">' + esc(shop) + ' is a HisaabNow shop, so its staff list lives in the HisaabNow app.</p>' +
      '<ol style="margin:6px 0 14px 18px;color:#182230;font-size:14.5px;line-height:1.6"><li>Open the HisaabNow app → <b>Staff</b> → <b>+</b> and add the person.</li>' +
      '<li>Open <b>Staff360</b> inside the app once — the list syncs here.</li>' +
      '<li>Back here, tap <b>Edit</b> on them and tick <b>Allow Staff360 login</b>.</li></ol>' +
      '<div class="s360-acts"><a class="s360-btn" href="https://app.hisaabnow.com/?go=staff360" target="_blank" rel="noopener">Open HisaabNow app</a>' +
      '<button type="button" class="s360-btn sec" data-a="newbiz">Set up a separate Staff360 business</button>' +
      '<button type="button" class="s360-btn sec" data-a="sheetclose">Close</button></div>');
  }

  function staffSheet(id) {
    var v = rosterInfo(); if (!v) return;
    var s = id ? v.staff.filter(function (x) { return x.id === id; })[0] : null;
    if (id && !s) return;
    s = s || { name: '', role: '', phone: '', salary: '', dailyWage: '', active: true, canLogin: false };
    var ro = !v.editable;
    var dis = ro ? ' disabled' : '';
    sheet('<h3>' + (id ? (ro ? 'Staff360 login · ' + esc(s.name) : 'Edit staff') : 'Add staff') + '</h3><form data-f="staff" data-id="' + esc(id || '') + '">' +
      '<label class="s360-fld"><span>Name</span><input class="s360-in" name="name" required maxlength="80" value="' + esc(s.name) + '"' + dis + ' placeholder="Ravi Kumar"></label>' +
      '<div class="s360-grid2"><label class="s360-fld"><span>Role</span><input class="s360-in" name="role" maxlength="40" list="s360-roles" value="' + esc(s.role) + '"' + dis + ' placeholder="Staff"></label>' +
      '<label class="s360-fld"><span>Mobile number</span><input class="s360-in" name="phone" inputmode="tel" maxlength="14" value="' + esc(s.phone ? String(s.phone).replace(/^\+91/, '') : '') + '" placeholder="10-digit mobile"></label></div>' +
      '<datalist id="s360-roles"><option>Staff</option><option>Manager</option><option>Cashier</option><option>Sales</option><option>Helper</option><option>Stylist</option><option>Cook</option><option>Receptionist</option></datalist>' +
      (ro ? '' : '<div class="s360-grid2"><label class="s360-fld"><span>Monthly salary ₹ (optional)</span><input class="s360-in" type="number" min="0" name="salary" value="' + esc(s.salary || '') + '"></label>' +
      '<label class="s360-fld"><span>Daily wage ₹ (optional)</span><input class="s360-in" type="number" min="0" name="dailyWage" value="' + esc(s.dailyWage || '') + '"></label></div>') +
      '<label class="s360-fld" style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" name="canLogin"' + (s.canLogin ? ' checked' : '') + ' style="margin-top:4px;width:18px;height:18px"><span style="margin:0;color:#0A0A0A"><b>Allow Staff360 login</b><br><small style="color:#5E5A50;font-weight:500">They sign in with this mobile number and OTP and see only their own attendance' + (has('self_checkin') ? ', and can check in / out with GPS.' : '. Self check-in needs Premium.') + '</small></span></label>' +
      (ro || !id ? '' : '<label class="s360-fld" style="display:flex;gap:10px;align-items:center"><input type="checkbox" name="inactive"' + (s.active ? '' : ' checked') + ' style="width:18px;height:18px"><span style="margin:0">Inactive (left the job)</span></label>') +
      '<div id="s360-sherr"></div><div class="s360-acts">' + (id && !ro && role() === 'owner' ? '<button type="button" class="s360-btn danger" data-a="staffdel" data-id="' + esc(id) + '">Remove</button>' : '') +
      '<span style="flex:1"></span><button type="button" class="s360-btn sec" data-a="sheetclose">Cancel</button><button class="s360-btn" type="submit">Save</button></div></form>');
  }

  /* Standalone marking screen (the HisaabNow app uses its own Step ATT). */
  R.mark = function () {
    var d = S.sub.date || todayLocal();
    var res = want('reg:' + d, function () { return call('staff360Register', { date: d }); });
    var h = '<div class="s360-h2">Mark attendance <button class="s360-lnk" data-a="go" data-v="register">Register ›</button></div>' +
      '<div class="s360-card" style="display:flex;align-items:center;justify-content:space-between;gap:8px"><button class="s360-btn sec sm" data-a="day" data-n="-1" aria-label="Previous day">‹</button>' +
      '<label style="flex:1;text-align:center"><span class="s360-sr">Date</span><input type="date" class="s360-in" style="max-width:190px" max="' + todayLocal() + '" value="' + d + '" data-a-sel="date"></label>' +
      '<button class="s360-btn sec sm" data-a="day" data-n="1" aria-label="Next day"' + (d >= todayLocal() ? ' disabled' : '') + '>›</button></div>';
    if (!res) return h + loading();
    if (res.e) return h + errBox(res.e, 'reg:' + d);
    var rows = res.v.rows;
    if (!rows.length) return h + '<div class="s360-card s360-empty">No staff yet. <button class="s360-lnk" data-a="addstaff">Add staff</button></div>';
    var un = rows.filter(function (r) { return !r.status; }).length;
    h += '<div class="s360-acts" style="margin-bottom:10px"><button class="s360-btn sm" data-a="mkall" data-d="' + d + '"' + (un ? '' : ' disabled') + '>✓ Mark ' + un + ' unmarked as Present</button></div>' +
      '<label class="s360-fld"><span>Reason for changes (optional, saved in the activity log)</span><input class="s360-in" id="s360-mkreason" maxlength="200" value="' + esc(S.sub.mkreason || '') + '" data-a-input="mkreason"></label><div class="s360-card">';
    h += rows.map(function (r) {
      return '<div class="s360-row" style="flex-wrap:wrap"><div class="s360-grow" style="min-width:140px"><b>' + esc(r.name) + '</b><small>' + esc(r.role || '') + (r.inHm ? ' · In ' + esc(r.inHm) + (r.outHm ? ' → ' + esc(r.outHm) : '') : '') + '</small></div><div class="s360-acts" role="group" aria-label="Status for ' + esc(r.name) + '">' +
        ['P', 'H', 'A', 'L', 'W'].map(function (k) {
          var on = r.status === k;
          return '<button class="s360-btn sm ' + (on ? '' : 'sec') + '" style="min-width:42px' + (on ? '' : '') + '" data-a="mk" data-sid="' + esc(r.staffId) + '" data-d="' + d + '" data-m="' + (on ? '' : k) + '" aria-pressed="' + on + '" title="' + MARK_LABEL[k] + '">' + k + '</button>';
        }).join('') + '</div></div>';
    }).join('');
    return h + '</div><div class="s360-note">P = Present · H = Half-day · A = Absent · L = Leave · W = Week off. Tap a selected status again to clear it.</div>';
  };
  function markOne(sid, d, m) {
    call('staff360Mark', { entries: [{ staffId: sid, date: d, status: m }], reason: S.sub.mkreason || '' }).then(function () {
      track('attendance_marked_manual', {}); invalidate('reg:'); invalidate('rep:'); invalidate('audit'); render();
    }, function (e) { toast(e.message); });
  }
  function markAllPresent(d) {
    var v = S.data['reg:' + d] && S.data['reg:' + d].v; if (!v) return;
    var entries = v.rows.filter(function (r) { return !r.status; }).map(function (r) { return { staffId: r.staffId, date: d, status: 'P' }; });
    if (!entries.length) return;
    call('staff360Mark', { entries: entries, reason: S.sub.mkreason || '' }).then(function () { invalidate('reg:'); invalidate('rep:'); invalidate('audit'); toast('✓ ' + entries.length + ' marked present'); render(); }, function (e) { toast(e.message); });
  }

  R.register = function () {
    var d = S.sub.date || todayLocal();
    var nav = '<div class="s360-card" style="display:flex;align-items:center;justify-content:space-between;gap:8px"><button class="s360-btn sec sm" data-a="day" data-n="-1" aria-label="Previous day">‹</button>' +
      '<label style="flex:1;text-align:center"><span class="s360-sr">Date</span><input type="date" class="s360-in" style="max-width:190px" max="' + todayLocal() + '" value="' + d + '" data-a-sel="date"></label>' +
      '<button class="s360-btn sec sm" data-a="day" data-n="1" aria-label="Next day"' + (d >= todayLocal() ? ' disabled' : '') + '>›</button></div>';
    var h = '<div class="s360-h2">Attendance register <button class="s360-btn sm" data-a="mark">Mark / edit</button></div>' + nav;
    if (!has('history_detailed')) {
      var L = staffLocal().filter(function (s) { return s.active !== false; });
      var flt = S.sub.st || 'all';
      h += '<div class="s360-acts" style="margin-bottom:8px">' + ['all', 'P', 'A', 'H'].map(function (k) { return '<button class="s360-btn sm ' + (flt === k ? '' : 'sec') + '" data-a="stf" data-k="' + k + '">' + (k === 'all' ? 'All' : MARK_LABEL[k]) + '</button>'; }).join('') + '</div><div class="s360-card">';
      var rows = L.filter(function (s) { var m = markLocal(s.id, d).m || ''; return flt === 'all' || m === flt; });
      h += rows.length ? rows.map(function (s) { var r = markLocal(s.id, d); return '<div class="s360-row"><div class="s360-grow"><b>' + esc(s.name) + '</b><small>' + (r.i ? 'In ' + esc(r.i) + (r.o ? ' → ' + esc(r.o) : '') : 'No punch times') + '</small></div>' + (r.m ? '<span class="s360-chip ' + r.m + '">' + MARK_LABEL[r.m] + '</span>' : '<span class="s360-chip">Not marked</span>') + '</div>'; }).join('') : '<div class="s360-empty">Nothing to show for this filter.</div>';
      return h + '</div>' + lockHTML('history_detailed');
    }
    var res = want('reg:' + d, function () { return call('staff360Register', { date: d }); });
    if (!res) return h + loading();
    if (res.e) return h + errBox(res.e, 'reg:' + d);
    var v = res.v;
    h += '<div class="s360-note">Times in ' + esc(v.timezone) + '. GPS is captured only at check-in and check-out and is evidence, not proof of presence.</div><div class="s360-card s360-scroll"><table class="s360-tbl"><thead><tr><th>Staff</th><th>Status</th><th>In</th><th>Out</th><th>Hours</th><th>Location</th></tr></thead><tbody>';
    h += v.rows.map(function (r) {
      var gpsCell = function (g, st) {
        if (g) return '<a href="https://maps.google.com/?q=' + g.lat + ',' + g.lng + '" target="_blank" rel="noopener" class="s360-lnk" style="padding:0">± ' + g.accuracy + ' m</a>' + (g.lowAccuracy ? ' <span class="s360-chip H">low accuracy</span>' : '');
        return st ? '<span class="s360-chip">' + esc(st === 'captured' ? '—' : 'No GPS: ' + st) + '</span>' : '—';
      };
      return '<tr><td><b>' + esc(r.name) + '</b>' + (r.shift ? '<br><small>' + esc(r.shift) + (r.weeklyOff ? ' · weekly off' : '') + '</small>' : '') + '</td>' +
        '<td>' + (r.status ? '<span class="s360-chip ' + r.status + '">' + MARK_LABEL[r.status] + '</span>' : '<span class="s360-chip">Not marked</span>') + (r.lateMin ? '<br><span class="s360-chip late">' + r.lateMin + ' min late</span>' : '') + '</td>' +
        '<td>' + esc(r.inHm || '—') + '</td><td>' + (r.incomplete ? (v.today && v.date === v.today ? '<span class="s360-chip P">Working</span>' : '<span class="s360-chip H">No check-out</span>') : esc(r.outHm || '—')) + (r.earlyMin ? '<br><small>' + r.earlyMin + ' min early</small>' : '') + '</td>' +
        '<td>' + (r.workedMin ? hm(r.workedMin) : '—') + '</td><td>' + gpsCell(r.checkInGps, r.checkInGpsStatus) + (r.checkOutAt ? '<br>' + gpsCell(r.checkOutGps, r.checkOutGpsStatus) : '') + '</td></tr>';
    }).join('');
    return h + '</tbody></table></div>';
  };

  R.shifts = function () {
    var res = want('shifts', function () { return call('staff360ListShifts', {}); });
    var h = '<div class="s360-h2">Shifts &amp; weekly offs <button class="s360-btn sm" data-a="shiftedit">+ Add shift</button></div>';
    if (!res) return h + loading();
    if (res.e) return h + errBox(res.e, 'shifts');
    var names = {}; staffLocal().forEach(function (s) { names[s.id] = s.name; });
    var list = res.v.shifts;
    if (!list.length) return h + '<div class="s360-card s360-empty">No shifts yet. Add one to start tracking late arrivals and working hours.</div>';
    return h + list.map(function (s) {
      var over = s.end <= s.start;
      return '<div class="s360-card"><div class="s360-row" style="border:0;padding:0"><div class="s360-grow"><b>' + esc(s.name) + ' · ' + esc(s.start) + '–' + esc(s.end) + (over ? ' <span class="s360-chip L">overnight</span>' : '') + '</b>' +
        '<small>Grace ' + (s.graceMin || 0) + ' min · Weekly off: ' + ((s.weeklyOff || []).length ? s.weeklyOff.map(function (d) { return WD[d]; }).join(', ') : 'none') + '</small>' +
        '<small>' + ((s.staffIds || []).length ? (s.staffIds || []).map(function (id) { return esc(names[id] || 'Removed staff'); }).join(', ') : 'No one assigned') + '</small></div>' +
        '<button class="s360-btn sec sm" data-a="shiftedit" data-id="' + esc(s.id) + '">Edit</button></div></div>';
    }).join('');
  };

  function shiftSheet(id) {
    var list = (S.data.shifts && S.data.shifts.v && S.data.shifts.v.shifts) || [];
    var s = list.filter(function (x) { return x.id === id; })[0] || { name: '', start: '09:00', end: '18:00', graceMin: 10, weeklyOff: [0], staffIds: [] };
    var staff = staffLocal().filter(function (x) { return x.active !== false; });
    sheet('<h3>' + (id ? 'Edit shift' : 'Add shift') + '</h3><form data-f="shift" data-id="' + esc(id || '') + '">' +
      '<label class="s360-fld"><span>Shift name</span><input class="s360-in" name="name" required maxlength="40" value="' + esc(s.name) + '" placeholder="Morning shift"></label>' +
      '<div class="s360-grid2"><label class="s360-fld"><span>Start</span><input class="s360-in" type="time" name="start" required value="' + esc(s.start) + '"></label><label class="s360-fld"><span>End</span><input class="s360-in" type="time" name="end" required value="' + esc(s.end) + '"></label></div>' +
      '<div class="s360-note">If the end is earlier than the start (e.g. 22:00–06:00) it is treated as an overnight shift.</div>' +
      '<label class="s360-fld"><span>Grace period (minutes)</span><input class="s360-in" type="number" min="0" max="180" name="graceMin" value="' + (s.graceMin || 0) + '"></label>' +
      '<fieldset class="s360-fld" style="border:0;padding:0;margin:0 0 12px"><legend style="font-size:12.5px;font-weight:700;color:#5E5A50;margin-bottom:5px">Weekly off</legend><div class="s360-days">' + WD.map(function (d, i) { return '<label><input type="checkbox" name="wo" value="' + i + '"' + ((s.weeklyOff || []).indexOf(i) >= 0 ? ' checked' : '') + '>' + d + '</label>'; }).join('') + '</div></fieldset>' +
      '<fieldset class="s360-fld" style="border:0;padding:0;margin:0 0 12px"><legend style="font-size:12.5px;font-weight:700;color:#5E5A50;margin-bottom:5px">Assign staff</legend><div class="s360-days">' + (staff.length ? staff.map(function (x) { return '<label><input type="checkbox" name="sid" value="' + esc(x.id) + '"' + ((s.staffIds || []).indexOf(x.id) >= 0 ? ' checked' : '') + '>' + esc(x.name) + '</label>'; }).join('') : '<span class="s360-note">No staff yet</span>') + '</div><div class="s360-note">Each person can be on one shift; assigning here moves them from any other shift.</div></fieldset>' +
      '<div id="s360-sherr"></div><div class="s360-acts">' + (id ? '<button type="button" class="s360-btn danger" data-a="shiftdel" data-id="' + esc(id) + '">Delete</button>' : '') + '<span style="flex:1"></span><button type="button" class="s360-btn sec" data-a="sheetclose">Cancel</button><button class="s360-btn" type="submit">Save shift</button></div></form>');
  }

  R.requests = function () {
    var f = S.sub.rq || 'pending';
    var key = 'req:' + f;
    var res = want(key, function () { return call('staff360ListRequests', { status: f === 'all' ? null : f }); });
    var h = '<div class="s360-h2">Leave &amp; correction requests</div><div class="s360-acts" style="margin-bottom:10px">' +
      ['pending', 'approved', 'rejected', 'all'].map(function (k) { return '<button class="s360-btn sm ' + (f === k ? '' : 'sec') + '" data-a="rqf" data-k="' + k + '">' + k[0].toUpperCase() + k.slice(1) + '</button>'; }).join('') + '</div>';
    if (!res) return h + loading();
    if (res.e) return h + errBox(res.e, key);
    if (!res.v.items.length) return h + '<div class="s360-card s360-empty">No ' + (f === 'all' ? '' : f + ' ') + 'requests.</div>';
    return h + res.v.items.map(function (r) {
      var what = r.type === 'leave' ? 'Leave · ' + fmtDate(r.fromDate) + (r.toDate !== r.fromDate ? ' – ' + fmtDate(r.toDate) : '')
        : 'Correction · ' + fmtDate(r.date) + ' · ' + [r.correction.status ? MARK_LABEL[r.correction.status] : '', r.correction.checkIn ? 'In ' + r.correction.checkIn : '', r.correction.checkOut ? 'Out ' + r.correction.checkOut : ''].filter(Boolean).join(', ');
      return '<div class="s360-card"><div class="s360-row" style="border:0;padding:0"><div class="s360-grow"><b>' + esc(r.staffName) + '</b><small>' + esc(what) + '</small><small>Reason: ' + esc(r.reason) + '</small>' +
        (r.status !== 'pending' ? '<small>' + (r.status === 'approved' ? '✓ Approved' : '✕ Rejected') + ' · ' + esc(fmtTime(r.decidedAt)) + (r.decisionNote ? ' · “' + esc(r.decisionNote) + '”' : '') + '</small>' : '') + '</div>' +
        '<span class="s360-chip ' + (r.status === 'approved' ? 'P' : r.status === 'rejected' ? 'A' : 'H') + '">' + esc(r.status) + '</span></div>' +
        (r.status === 'pending' ? '<div class="s360-acts" style="margin-top:10px"><button class="s360-btn sm" data-a="decide" data-d="approved" data-id="' + esc(r.id) + '">Approve</button><button class="s360-btn danger sm" data-a="decide" data-d="rejected" data-id="' + esc(r.id) + '">Reject</button></div>' : '') + '</div>';
    }).join('');
  };

  R.reports = function () {
    var t = todayLocal(), per = S.sub.per || 'this_month';
    var from, to = t, ym = t.slice(0, 7);
    if (per === 'last_month') { var lm = addDays(ym + '-01', -1); ym = lm.slice(0, 7); from = ym + '-01'; to = lm; }
    else if (per === 'custom') { from = S.sub.from || addDays(t, -6); to = S.sub.to || t; }
    else from = ym + '-01';
    var sf = S.sub.rs || '';
    var h = '<div class="s360-h2">Attendance reports</div><div class="s360-card"><div class="s360-grid2"><label class="s360-fld"><span>Period</span><select class="s360-sel" data-a-sel="per">' +
      [['this_month', 'This month'], ['last_month', 'Last month'], ['custom', 'Custom range']].map(function (o) { return '<option value="' + o[0] + '"' + (per === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<label class="s360-fld"><span>Employee</span><select class="s360-sel" data-a-sel="rs"><option value="">All staff</option>' + staffLocal().map(function (s) { return '<option value="' + esc(s.id) + '"' + (sf === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></label></div>' +
      (per === 'custom' ? '<div class="s360-grid2"><label class="s360-fld"><span>From</span><input type="date" class="s360-in" data-a-sel="from" value="' + from + '" max="' + t + '"></label><label class="s360-fld"><span>To</span><input type="date" class="s360-in" data-a-sel="to" value="' + to + '" max="' + t + '"></label></div>' : '') + '</div>';
    track('attendance_report_viewed', { plan: plan(), period: per });
    if (!has('report_detailed') && !SA) {
      // Basic: totals from Step ATT locally (works even before the server is deployed).
      var sum = null; try { sum = window.HNAttend && HNAttend.summary ? HNAttend.summary(ym) : null; } catch (e) {}
      if (per === 'custom') h += '<div class="s360-warn">Custom ranges are a Premium report. Showing the month view.</div>';
      if (!sum) return h + '<div class="s360-err">Attendance data is not available.</div>';
      var rows = sum.rows.filter(function (r) { return !sf || r.id === sf; });
      h += '<div class="s360-card s360-scroll"><table class="s360-tbl"><thead><tr><th>Staff</th><th>Present</th><th>Half</th><th>Absent</th><th>Leave</th><th>Week off</th><th>Not marked</th></tr></thead><tbody>' +
        rows.map(function (r) { return '<tr><td><b>' + esc(r.name) + '</b></td><td>' + r.P + '</td><td>' + r.H + '</td><td>' + r.A + '</td><td>' + r.L + '</td><td>' + r.W + '</td><td>' + r.unmarked + '</td></tr>'; }).join('') +
        '</tbody></table></div><div class="s360-acts"><button class="s360-btn sec" data-a="basiccsv" data-ym="' + ym + '">Download month CSV</button></div>' + lockHTML('report_detailed');
      return h;
    }
    var key = 'rep:' + from + ':' + to + ':' + sf;
    var res = want(key, function () { return call('staff360Report', { from: from, to: to, staffId: sf || null }); });
    if (!res) return h + loading();
    if (res.e) return h + errBox(res.e, key);
    var v = res.v, T = v.total;
    if (!v.detailed) {
      return h + '<div class="s360-card s360-scroll"><table class="s360-tbl"><thead><tr><th>Staff</th><th>Present</th><th>Half</th><th>Absent</th><th>Leave</th><th>Week off</th><th>Not marked</th></tr></thead><tbody>' +
        v.rows.map(function (r) { return '<tr><td><b>' + esc(r.name) + '</b></td><td>' + r.P + '</td><td>' + r.H + '</td><td>' + r.A + '</td><td>' + r.L + '</td><td>' + r.W + '</td><td>' + r.unmarked + '</td></tr>'; }).join('') +
        '</tbody></table></div>' + lockHTML('report_detailed');
    }
    h += '<div class="s360-stats"><div class="s360-stat p"><span>Present days</span><b>' + (T.P + T.H * 0.5) + '</b></div><div class="s360-stat a"><span>Absent days</span><b>' + T.A + '</b></div><div class="s360-stat l"><span>Late arrivals</span><b>' + T.late + '</b></div><div class="s360-stat"><span>Hours</span><b style="font-size:18px">' + hm(T.workedMin) + '</b></div></div>';
    h += '<div class="s360-card s360-scroll"><table class="s360-tbl"><thead><tr><th>Staff</th><th>Present</th><th>Half</th><th>Absent</th><th>Leave</th><th>Late</th><th>Early</th><th>No check-out</th><th>Hours</th></tr></thead><tbody>' +
      v.rows.map(function (r) { return '<tr><td><b>' + esc(r.name) + '</b></td><td>' + r.P + '</td><td>' + r.H + '</td><td>' + r.A + '</td><td>' + r.L + '</td><td>' + r.late + '</td><td>' + r.earlyLeaves + '</td><td>' + r.incomplete + '</td><td>' + hm(r.workedMin) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    h += '<div class="s360-acts">' + (v.exportAllowed ? '<button class="s360-btn sec" data-a="csv" data-k="' + esc(key) + '">Export CSV / Excel</button>' : '') +
      (has('ai_summary') ? '<button class="s360-btn gold" data-a="go" data-v="ai">👑 AI summary</button>' : '<button class="s360-btn sec" data-a="go" data-v="plans">👑 AI summary · King PRO</button>') + '</div>' +
      '<div class="s360-note">Hours come only from check-in/check-out. Days with a check-in but no check-out are listed and not counted — no time is assumed.</div>';
    return h;
  };

  function csvCell(v) { v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function downloadCsv(name, lines) {
    var blob = new Blob(['﻿' + lines.map(function (l) { return l.map(csvCell).join(','); }).join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) {} }, 500);
  }

  /* ───── King PRO ───── */
  R.ai = function () {
    var tab = S.sub.ai || 'dash';
    var tabs = '<div class="s360-acts" style="margin-bottom:10px">' + [['dash', 'Dashboard'], ['ask', 'Ask Staff360 AI'], ['alerts', 'Patterns to review'], ['salary', 'Salary assistant']].map(function (x) {
      return '<button class="s360-btn sm ' + (tab === x[0] ? 'gold' : 'sec') + '" data-a="aitab" data-k="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';
    var aiOn = S.st && S.st.ai && S.st.ai.configured;
    var cfgNote = aiOn ? '' : '<div class="s360-warn">AI provider not configured. Summaries use a fixed template and questions are answered by Staff360’s built-in rules — every number still comes from your attendance records.</div>';
    if (tab === 'ask') return tabs + cfgNote + askHTML();
    if (tab === 'salary') return tabs + salaryHTML();
    var res = want('aidash', function () { return call('staff360AIDashboard', {}); });
    if (!res) return tabs + loading();
    if (res.e) return tabs + errBox(res.e, 'aidash');
    var v = res.v;
    if (tab === 'alerts') return tabs + alertsHTML(v.anomalies, v);
    track('kingpro_ai_insight_viewed', {});
    var open = v.anomalies.filter(function (a) { return !a.review || a.review.state === 'open'; });
    var h = tabs + cfgNote + '<div class="s360-card king"><div class="s360-h2" style="margin-top:0">Today’s summary <span class="s360-src ' + (v.narrativeSource === 'ai' ? 'ai' : '') + '">' + (v.narrativeSource === 'ai' ? 'AI · from records' : 'Template · from records') + '</span></div><div>' + esc(v.narrative) + '</div><div class="s360-note">Period for patterns: last 30 days. ' + esc(fmtDate(v.today)) + '.</div></div>';
    h += '<div class="s360-stats"><div class="s360-stat p"><span>Present</span><b>' + (v.counts.P + v.counts.H) + '</b></div><div class="s360-stat l"><span>Late</span><b>' + v.counts.late + '</b></div><div class="s360-stat a"><span>Absent / leave</span><b>' + (v.counts.A + v.counts.L) + '</b></div><div class="s360-stat"><span>Not marked</span><b>' + v.counts.notMarked + '</b></div></div>';
    h += '<div class="s360-split"><div><div class="s360-h2">Patterns to review <button class="s360-lnk" data-a="aitab" data-k="alerts">View all ›</button></div>' +
      (open.length ? open.slice(0, 4).map(alertCard).join('') : '<div class="s360-card s360-empty">Nothing unusual in the last 30 days.</div>') + '</div><div>' +
      '<div class="s360-h2">Salary estimate</div><div class="s360-card"><b>' + (v.salary.drafts ? rs(v.salary.totalGross) + ' draft · ' + v.salary.approved + ' approved' : 'Not reviewed yet for ' + esc(v.salary.ym)) + '</b><div class="s360-note">Draft only — you review and approve. Nothing is paid automatically.</div><button class="s360-btn sec sm" data-a="aitab" data-k="salary">Review</button></div>' +
      '<div class="s360-h2">Staff availability tomorrow</div><div class="s360-card">' + (v.availability.sufficient ? '<b>' + v.availability.expected + ' of ' + v.availability.of + ' likely available</b>' : '<b>Not enough history yet</b>') + '<div class="s360-note">' + esc(v.availability.limitation) + '</div></div>' +
      '<button class="s360-btn gold wide" data-a="aitab" data-k="ask">Ask Staff360 AI</button></div></div>';
    return h;
  };

  function alertCard(a) {
    var st = a.review && a.review.state !== 'open' ? a.review.state : 'open';
    return '<div class="s360-card"><div class="s360-row" style="border:0;padding:0"><div class="s360-grow"><b>' + esc(a.title) + ' · ' + esc(a.staffName) + '</b><small>' + esc(a.summary) + '</small><small>Period: ' + esc(fmtDate(a.period.from)) + ' – ' + esc(fmtDate(a.period.to)) + '</small></div>' +
      '<span class="s360-chip ' + (st === 'open' ? 'H' : 'W') + '">' + (st === 'open' ? 'to review' : esc(st)) + '</span></div>' +
      '<details class="s360-det"><summary>Evidence (' + a.evidence.length + ' records)</summary><ul>' + a.evidence.map(function (e) { return '<li>' + esc(fmtDate(e.date)) + ' — ' + esc(e.detail) + '</li>'; }).join('') + '</ul>' +
      '<div class="s360-note">This is a pattern in the records, not a judgement about the person. Talk to them before acting.</div></details>' +
      (st === 'open' ? '<div class="s360-acts" style="margin-top:8px"><button class="s360-btn sec sm" data-a="alert" data-s="reviewed" data-id="' + esc(a.id) + '">Mark reviewed</button><button class="s360-btn sec sm" data-a="alert" data-s="dismissed" data-id="' + esc(a.id) + '">Dismiss</button></div>' :
        '<div class="s360-acts" style="margin-top:8px"><button class="s360-lnk" data-a="alert" data-s="open" data-id="' + esc(a.id) + '">Re-open</button></div>') + '</div>';
  }
  function alertsHTML(list) {
    if (!list.length) return '<div class="s360-card s360-empty">No patterns to review in the last 30 days.</div>';
    return '<div class="s360-note">Flags come from fixed rules over your records: 3+ late arrivals (configurable), missing check-outs, check-ins far from a person’s usual time, and repeated punch attempts.</div>' + list.map(alertCard).join('');
  }

  var SUGG = ['Who is absent today?', 'Who has been late most often this month?', 'Show employees with 3+ late arrivals this month', 'How many hours did everyone work this month?', 'Which employees have irregular attendance?', 'What is my estimated salary payout this month?', 'How many employees are likely available tomorrow?'];
  function askHTML() {
    var h = '<div class="s360-sugg" aria-label="Suggested questions">' + SUGG.map(function (q) { return '<button data-a="ask" data-q="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div><div class="s360-chat" aria-live="polite">';
    if (!S.chat.length) h += '<div class="s360-card s360-empty">Ask about attendance, late arrivals, hours, salary drafts or tomorrow’s availability. Answers show their date range and source records.</div>';
    h += S.chat.map(function (m) {
      if (m.me) return '<div class="s360-msg me">' + esc(m.text) + '</div>';
      if (m.pending) return '<div class="s360-msg" aria-busy="true">Checking records…</div>';
      if (m.err) return '<div class="s360-msg" style="border-color:#F3C6C1">' + esc(m.err) + '</div>';
      var r = m.res, src = r.source === 'ai' ? '<span class="s360-src ai">AI · grounded in records</span>' : '<span class="s360-src">Rules engine · AI not configured</span>';
      var items = (r.results || []).map(function (x) { return (x.items || []).map(function (i) { return '<li><b>' + esc(i.name) + '</b> — ' + esc(i.value) + (i.note ? ' <small>(' + esc(i.note) + ')</small>' : '') + ((i.evidence || []).length ? '<details class="s360-det"><summary>Source records</summary><ul>' + i.evidence.slice(0, 31).map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></details>' : '') + '</li>'; }).join(''); }).join('');
      var per = r.period ? 'Date range: ' + esc(r.period.from) + (r.period.to !== r.period.from ? ' to ' + esc(r.period.to) : '') : '';
      return '<div class="s360-msg"><div>' + esc(r.text) + '</div>' + (items ? '<ul style="margin:8px 0 0;padding-left:18px">' + items + '</ul>' : '') + '<small>' + src + ' ' + per + '</small></div>';
    }).join('');
    h += '</div><form class="s360-ask" data-f="ask"><label style="flex:1"><span class="s360-sr">Your question</span><input class="s360-in" name="q" maxlength="300" placeholder="Type a question…" autocomplete="off"></label><button class="s360-btn gold" type="submit">Send</button></form>';
    return h;
  }

  function salaryHTML() {
    var t = todayLocal(), ym = S.sub.ym || t.slice(0, 7);
    var key = 'sal:' + ym;
    var res = want(key, function () { return call('staff360SalaryList', { ym: ym }); });
    var h = '<div class="s360-card" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><label class="s360-fld" style="margin:0"><span>Month</span><input type="month" class="s360-in" data-a-sel="ym" value="' + ym + '" max="' + t.slice(0, 7) + '"></label><div class="s360-note" style="flex:1">Draft estimate · owner review required. Staff360 never pays, files returns or finalises payroll.</div></div>';
    if (!res) return h + loading();
    if (res.e) return h + errBox(res.e, key);
    var v = res.v;
    if (v.partialMonth) h += '<div class="s360-warn">This month is not over — the estimate uses attendance up to today.</div>';
    h += '<div class="s360-card king"><b>Estimated gross: ' + rs(v.totalGross) + '</b> <span class="s360-note">across ' + v.rows.length + ' staff</span></div>';
    var isOwner = role() === 'owner';
    return h + v.rows.map(function (r) {
      var x = r.result;
      return '<div class="s360-card"><div class="s360-row" style="border:0;padding:0"><div class="s360-grow"><b>' + esc(r.name) + '</b><small>' + (x.basis === 'monthly' ? 'Monthly salary' : 'Daily wage') + ' · Payable days ' + x.payableDays + (x.overtimeHours ? ' · OT ' + x.overtimeHours + 'h' : '') + '</small></div><b style="font-size:17px">' + rs(x.gross) + '</b></div>' +
        (x.missing.length ? '<div class="s360-warn" style="margin-top:8px">Missing: ' + esc(x.missing.join(', ')) + '. Edit inputs to set it.</div>' : '') +
        (r.unmarked ? '<div class="s360-note">' + r.unmarked + ' day(s) not marked are not paid in this draft.</div>' : '') +
        '<details class="s360-det"><summary>View calculation</summary><ul>' + x.formula.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul></details>' +
        '<div class="s360-acts" style="margin-top:8px"><button class="s360-btn sec sm" data-a="saledit" data-id="' + esc(r.staffId) + '">Edit inputs</button>' +
        (r.status === 'approved' ? '<span class="s360-chip P">Approved ' + esc(fmtTime(r.approvedAt)) + '</span>' : (isOwner ? '<button class="s360-btn sm" data-a="salok" data-id="' + esc(r.staffId) + '">Approve draft</button>' : '<span class="s360-chip H">Draft · owner approves</span>')) + '</div></div>';
    }).join('');
  }

  function salarySheet(sid) {
    var ym = S.sub.ym || todayLocal().slice(0, 7);
    var v = S.data['sal:' + ym] && S.data['sal:' + ym].v;
    var r = v && v.rows.filter(function (x) { return x.staffId === sid; })[0]; if (!r) return;
    var x = r.result;
    sheet('<h3>Salary inputs · ' + esc(r.name) + '</h3><form data-f="salary" data-id="' + esc(sid) + '">' +
      '<label class="s360-fld"><span>Basis</span><select class="s360-sel" name="basis"><option value="monthly"' + (x.basis === 'monthly' ? ' selected' : '') + '>Monthly salary</option><option value="daily"' + (x.basis === 'daily' ? ' selected' : '') + '>Daily wage</option></select></label>' +
      '<div class="s360-grid2"><label class="s360-fld"><span>Monthly salary ₹</span><input class="s360-in" type="number" min="0" name="monthlySalary" value="' + (r.overrides.monthlySalary != null ? r.overrides.monthlySalary : (x.basis === 'monthly' ? Math.round(x.perDay * x.divisor) : '')) + '"></label>' +
      '<label class="s360-fld"><span>Days to divide by</span><input class="s360-in" type="number" min="1" max="31" name="divisor" value="' + x.divisor + '"></label></div>' +
      '<label class="s360-fld"><span>Daily wage ₹ (if daily basis)</span><input class="s360-in" type="number" min="0" name="dailyWage" value="' + (r.overrides.dailyWage != null ? r.overrides.dailyWage : (x.basis === 'daily' ? x.perDay : '')) + '"></label>' +
      '<div class="s360-grid2"><label class="s360-fld"><span>Overtime hours</span><input class="s360-in" type="number" min="0" step="0.5" name="overtimeHours" value="' + x.overtimeHours + '"></label><label class="s360-fld"><span>Overtime ₹ per hour</span><input class="s360-in" type="number" min="0" name="overtimeRate" value="' + x.overtimeRate + '"></label></div>' +
      '<label class="s360-fld" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="leavePaid"' + (x.leavePaid ? ' checked' : '') + '> <span style="margin:0">Approved leave is paid</span></label>' +
      '<div class="s360-note">Saving keeps this as a draft and records the change in the activity log.</div><div id="s360-sherr"></div>' +
      '<div class="s360-acts"><span style="flex:1"></span><button type="button" class="s360-btn sec" data-a="sheetclose">Cancel</button><button class="s360-btn" type="submit">Save draft</button></div></form>');
  }

  R.whatsapp = function () {
    var res = want('wa', function () { return call('staff360WhatsApp', { op: 'get' }); });
    var h = '<div class="s360-h2">WhatsApp attendance reports</div>';
    if (!res) return h + loading();
    if (res.e) return h + errBox(res.e, 'wa');
    var v = res.v, s = v.settings || {};
    h += v.providerConfigured ? '<div class="s360-ok">WhatsApp provider connected.</div>' : '<div class="s360-warn"><b>Provider not configured.</b> You can save your preferences, but nothing will be sent until HisaabNow’s WhatsApp Business provider is set up.</div>';
    var ownerPhone = (window.kfAuth && kfAuth.currentUser && kfAuth.currentUser.phoneNumber) || '';
    h += '<form class="s360-card" data-f="wa"><label class="s360-fld"><span>Recipient (full number with +91)</span><input class="s360-in" name="recipient" inputmode="tel" required value="' + esc(s.recipient || ownerPhone) + '" placeholder="+919876543210"></label>' +
      '<div class="s360-grid2"><label class="s360-fld"><span>Frequency</span><select class="s360-sel" name="cadence"><option value="daily"' + (s.cadence !== 'weekly' ? ' selected' : '') + '>Daily</option><option value="weekly"' + (s.cadence === 'weekly' ? ' selected' : '') + '>Weekly</option></select></label>' +
      '<label class="s360-fld"><span>Send time</span><input class="s360-in" type="time" name="sendTime" required value="' + esc(s.sendTime || '20:30') + '"></label></div>' +
      '<label class="s360-fld"><span>Day (weekly)</span><select class="s360-sel" name="weekday">' + WD.map(function (d, i) { return '<option value="' + i + '"' + ((s.weekday == null ? 1 : s.weekday) === i ? ' selected' : '') + '>' + d + '</option>'; }).join('') + '</select></label>' +
      '<div class="s360-note">Includes: present / absent / leave / not marked, late arrivals and hours logged.</div>' +
      '<label class="s360-fld" style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" name="consent"' + (s.optIn && s.enabled ? ' checked' : '') + ' style="margin-top:3px"> <span style="margin:0;color:#0A0A0A;font-weight:600">I agree to receive these attendance reports on WhatsApp at this number. I can turn them off any time.</span></label>' +
      '<div id="s360-waerr"></div><div class="s360-acts"><button type="button" class="s360-btn sec" data-a="wapreview">Preview message</button><button class="s360-btn" type="submit">Save settings</button>' + (s.enabled ? '<button type="button" class="s360-btn danger" data-a="waoff">Turn off reports</button>' : '') + '</div></form>';
    if (S.sub.waPreview) h += '<div class="s360-card"><b>Preview</b><pre style="white-space:pre-wrap;font-family:inherit;margin:8px 0 0">' + esc(S.sub.waPreview) + '</pre></div>';
    h += '<div class="s360-h2">Delivery log</div><div class="s360-card">' + (v.log.length ? v.log.map(function (l) { return '<div class="s360-row"><div class="s360-grow"><b>' + esc(fmtTime(l.at)) + '</b><small>' + (l.ok ? 'Delivered to provider' : 'Failed: ' + esc(l.error || 'unknown')) + '</small></div><span class="s360-chip ' + (l.ok ? 'P' : 'A') + '">' + (l.ok ? 'sent' : 'failed') + '</span></div>'; }).join('') : '<div class="s360-empty">Nothing sent yet.</div>') + '</div>';
    return h;
  };

  R.activity = function () {
    var res = want('audit', function () { return call('staff360ListAudit', {}); });
    var h = '<div class="s360-h2">Attendance activity</div>';
    var q = auditQueue();
    if (q.length) h += '<div class="s360-warn">' + q.length + ' change(s) on this device are waiting to be logged. They will be sent when the Staff360 server is reachable.</div>';
    if (!res) return h + loading();
    if (res.e) return h + errBox(res.e, 'audit');
    var L = res.v.items;
    if (!L.length) return h + '<div class="s360-card s360-empty">No activity yet. Attendance changes, punches, requests and approvals will appear here.</div>';
    var DESC = {
      manual_mark: function (a) { return (a.actorRole === 'manager' ? 'Manager' : 'Owner') + ' changed ' + a.staffName + ' on ' + fmtDate(a.date) + ': ' + (MARK_LABEL[a.from] || 'Not marked') + ' → ' + (MARK_LABEL[a.to] || 'Not marked'); },
      punch_in: function (a) { return a.staffName + ' checked in at ' + a.to + (a.gps === 'captured' ? ' (GPS recorded)' : ' (no GPS: ' + a.gps + ')'); },
      punch_out: function (a) { return a.staffName + ' checked out at ' + a.to + (a.gps === 'captured' ? ' (GPS recorded)' : ' (no GPS: ' + a.gps + ')'); },
      request_created: function (a) { return a.staffName + ' requested ' + a.to; },
      request_approved: function (a) { return (a.actorRole === 'manager' ? 'Manager' : 'Owner') + ' approved ' + a.staffName + '’s request'; },
      request_rejected: function (a) { return (a.actorRole === 'manager' ? 'Manager' : 'Owner') + ' rejected ' + a.staffName + '’s request'; },
    };
    return h + '<div class="s360-card">' + L.map(function (a) {
      var d = DESC[a.type] ? DESC[a.type](a) : String(a.type).replace(/_/g, ' ') + (a.to ? ': ' + a.to : '');
      return '<div class="s360-row"><div class="s360-grow"><b class="wrap">' + esc(d) + '</b><small>' + esc(fmtTime(a.at)) + (a.reason ? ' · Reason: ' + esc(a.reason) : '') + '</small></div></div>';
    }).join('') + '</div>';
  };

  R.plans = function () {
    var cfg = (S.st && S.st.plans) || { basic: { name: 'Basic' }, premium: { name: 'Premium' }, kingpro: { name: 'King PRO', priceYearInr: 4999 } };
    var cur = plan();
    var price = function (id) { var p = cfg[id] && cfg[id].priceYearInr; return p ? rs(p) + ' <small>/ year</small>' : '<small>Price to be configured</small>'; };
    var lim = function (id) { var m = cfg[id] && cfg[id].maxStaff; return m ? 'Up to ' + m + ' staff' : ''; };
    var col = function (id, title, tag, list, cta) {
      var isCur = cur === id;
      return '<div class="s360-plan ' + id + (isCur ? ' cur' : '') + '"><div class="s360-chip ' + (id === 'kingpro' ? 'H' : id === 'premium' ? 'P' : '') + '" style="align-self:flex-start">' + tag + '</div><h3>' + title + '</h3><div class="s360-price">' + price(id) + '</div>' +
        (lim(id) ? '<div class="s360-note">' + lim(id) + '</div>' : '') + '<ul>' + list.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' +
        (isCur ? '<button class="s360-btn sec" disabled>Current plan</button>' : (RANK[id] < RANK[cur] ? '<button class="s360-btn sec" disabled>Included in your plan</button>' : cta)) + '</div>';
    };
    var exp = S.st && S.st.entitlement;
    var h = '<div class="s360-h2">Choose your Staff360 plan</div>';
    if (exp && exp.lapsedFrom) h += '<div class="s360-warn">Your ' + esc(NEED[exp.lapsedFrom] || exp.lapsedFrom) + ' plan has ended. All staff and attendance records are kept; higher-tier features are locked until you renew.</div>';
    if (exp && exp.inGrace) h += '<div class="s360-warn">Your plan ended on ' + esc(fmtTime(exp.endAt)) + '. Features stay on for a short grace period — renew to keep them.</div>';
    h += '<div class="s360-plans">' +
      col('basic', 'Basic', 'Simple attendance', ['Owner / manager marks attendance', 'Present, absent, half-day, leave, week off', 'Daily register &amp; month history', 'Month CSV'], '<button class="s360-btn sec" disabled>Included</button>') +
      col('premium', 'Premium', 'Digital staff management', ['Everything in Basic', 'Staff check in / out from own phone', 'GPS captured at each punch', 'Shifts, weekly offs, late &amp; early tracking', 'Working hours', 'Leave &amp; correction requests', 'Detailed reports &amp; export'], '<button class="s360-btn" data-a="buy" data-p="premium">Upgrade to Premium</button>') +
      col('kingpro', '👑 King PRO', 'AI Staff Manager', ['Everything in Premium', 'AI attendance assistant', 'Late-pattern &amp; missed-punch alerts with evidence', 'AI summaries', 'Salary estimate drafts (you approve)', 'Availability insights', 'WhatsApp summaries (opt-in)'], '<button class="s360-btn gold" data-a="buy" data-p="kingpro">Upgrade to King PRO</button>') + '</div>';
    h += '<div class="s360-note">Staff360 is an add-on to your HisaabNow plan. No face recognition, selfies or biometrics are used in any plan. Taxes as applicable per HisaabNow billing.</div><div id="s360-buymsg"></div>';
    return h;
  };

  R.settings = function () {
    var st = S.st && S.st.settings;
    if (!st) return loading();
    var tzs = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Kathmandu', 'Asia/Dhaka', 'Asia/Singapore', 'Europe/London', 'America/New_York'];
    if (tzs.indexOf(st.timezone) < 0) tzs.unshift(st.timezone);
    return '<div class="s360-h2">Attendance settings</div><form class="s360-card" data-f="settings">' +
      '<label class="s360-fld"><span>Business timezone (decides which day a punch belongs to)</span><select class="s360-sel" name="timezone">' + tzs.map(function (z) { return '<option' + (z === st.timezone ? ' selected' : '') + '>' + z + '</option>'; }).join('') + '</select></label>' +
      '<label class="s360-fld"><span>If an employee’s location is unavailable</span><select class="s360-sel" name="gpsPolicy"><option value="require"' + (st.gpsPolicy === 'require' ? ' selected' : '') + '>Block check-in — ask them to turn on location</option><option value="allow_without"' + (st.gpsPolicy === 'allow_without' ? ' selected' : '') + '>Allow check-in, mark it “no GPS”</option></select></label>' +
      '<div class="s360-grid2"><label class="s360-fld"><span>Flag accuracy worse than (metres)</span><input class="s360-in" type="number" min="10" max="5000" name="minAccuracyM" value="' + st.minAccuracyM + '"></label>' +
      '<label class="s360-fld"><span>Late arrivals before a pattern alert</span><input class="s360-in" type="number" min="2" max="15" name="lateThreshold" value="' + st.lateThreshold + '"></label></div>' +
      '<label class="s360-fld" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="mirrorToRegister"' + (st.mirrorToRegister ? ' checked' : '') + '> <span style="margin:0">Copy employee punches into the daily register and month salary sheet</span></label>' +
      '<div id="s360-seterr"></div><button class="s360-btn" type="submit">Save settings</button></form>' + privacyHTML() +
      '<div class="s360-note">Geofencing (blocking punches outside a radius) is not part of this release. Location is shown with its accuracy so you can judge it yourself.</div>';
  };

  function privacyHTML() {
    return '<details class="s360-card s360-det"><summary>Location &amp; privacy</summary><ul>' +
      '<li>Location is read once at check-in and once at check-out, only when the employee taps the button. Never in the background.</li>' +
      '<li>Stored: latitude, longitude, accuracy and time of each punch. Visible to the owner and managers of this shop only.</li>' +
      '<li>Not used for face recognition, selfies, biometrics or continuous tracking.</li>' +
      '<li>Kept with the attendance record for as long as the shop keeps its HisaabNow data, and deleted with it (see HisaabNow Privacy Policy and Delete Account).</li></ul></details>';
  }

  /* ───────── sheet ───────── */
  function sheet(inner) {
    sheetClose();
    var bg = document.createElement('div'); bg.className = 's360-sheet-bg'; bg.id = 's360-sheet';
    bg.innerHTML = '<div class="s360-sheet" role="dialog" aria-modal="true">' + inner + '</div>';
    bg.addEventListener('click', function (e) { if (e.target === bg) sheetClose(); });
    bg.addEventListener('click', onClick); bg.addEventListener('submit', onSubmit);
    document.body.appendChild(bg);
    var f = bg.querySelector('input,select,textarea,button'); if (f) try { f.focus(); } catch (e) {}
  }
  function sheetClose() { var s = $('s360-sheet'); if (s) s.remove(); }
  function sheetErr(id, e) { var x = $(id); if (x) x.innerHTML = '<div class="s360-err" role="alert">' + esc(e && e.message || e) + '</div>'; }

  /* ───────── events ───────── */
  function onClick(e) {
    var b = e.target.closest ? e.target.closest('[data-a]') : null; if (!b) return;
    var a = b.getAttribute('data-a'), id = b.getAttribute('data-id');
    if (a === 'close') return close();
    if (a === 'go') return go(b.getAttribute('data-v'));
    if (a === 'retry') { S.stErr = null; loadState(true).then(render); return render(); }
    if (a === 'reload') { delete S.data[b.getAttribute('data-k')]; return render(); }
    if (a === 'menu') { if (window.STAFF360_SHELL) STAFF360_SHELL.menu(); return; }
    if (a === 'newbiz') { sheetClose(); if (window.STAFF360_SHELL && STAFF360_SHELL.newBusiness) STAFF360_SHELL.newBusiness(); return; }
    if (a === 'mark') { if (SA) return go('mark'); close(); if (window.HNAttend) HNAttend.open(); return; }
    if (a === 'addstaff') {
      if (SA) {
        var ri = rosterInfo();
        if (ri && !ri.editable) return shopAddInfo();
        if (S.view !== 'team') go('team');
        if (ri) return staffSheet(null);
        var rr = S.data.roster;
        if (rr && rr.e) { toast(rr.e.message || 'Could not load staff'); return; }
        S.sub.pendingAdd = true; return;
      } close(); try { App.nav('add-staff'); } catch (x) {} return; }
    if (a === 'editstaff' && SA) return staffSheet(id);
    if (a === 'mk') return markOne(b.getAttribute('data-sid'), b.getAttribute('data-d'), b.getAttribute('data-m'));
    if (a === 'mkall') return markAllPresent(b.getAttribute('data-d'));
    if (a === 'staffdel') {
      return confirmBox({ title: 'Remove this staff member?', message: 'Their attendance history is kept. They can no longer log in.', confirmText: 'Remove', dangerous: true }).then(function (ok) {
        if (!ok) return; call('staff360StaffRemove', { id: id }).then(function () { sheetClose(); invalidate('roster'); invalidate('reg:'); toast('Removed'); render(); }, function (er) { sheetErr('s360-sherr', er); });
      });
    }
    if (a === 'editstaff') { close(); try { if (App.editStaffFromDetail) App.editStaffFromDetail(id); else App.nav('staff'); } catch (x) { try { App.nav('staff'); } catch (y) {} } return; }
    if (a === 'myself') { close(); openEmployee(); return; }
    if (a === 'day') { S.sub.date = addDays(S.sub.date || todayLocal(), +b.getAttribute('data-n')); if (S.sub.date > todayLocal()) S.sub.date = todayLocal(); return render(); }
    if (a === 'stf') { S.sub.st = b.getAttribute('data-k'); return render(); }
    if (a === 'rqf') { S.sub.rq = b.getAttribute('data-k'); return render(); }
    if (a === 'aitab') { S.sub.ai = b.getAttribute('data-k'); if (S.view !== 'ai') S.view = 'ai'; return render(); }
    if (a === 'shiftedit') return shiftSheet(id);
    if (a === 'sheetclose') return sheetClose();
    if (a === 'shiftdel') {
      return confirmBox({ title: 'Delete this shift?', message: 'Staff on it will have no shift. Past attendance is not changed.', confirmText: 'Delete', dangerous: true }).then(function (ok) {
        if (!ok) return; call('staff360DeleteShift', { id: id }).then(function () { sheetClose(); invalidate('shifts'); invalidate('reg:'); toast('Shift deleted'); render(); }, function (er) { sheetErr('s360-sherr', er); });
      });
    }
    if (a === 'decide') {
      var d = b.getAttribute('data-d');
      sheet('<h3>' + (d === 'approved' ? 'Approve request' : 'Reject request') + '</h3><form data-f="decide" data-id="' + esc(id) + '" data-d="' + d + '"><label class="s360-fld"><span>' + (d === 'approved' ? 'Note (optional)' : 'Reason (required)') + '</span><textarea class="s360-ta" name="note" maxlength="300"' + (d === 'rejected' ? ' required minlength="3"' : '') + '></textarea></label><div id="s360-sherr"></div><div class="s360-acts"><span style="flex:1"></span><button type="button" class="s360-btn sec" data-a="sheetclose">Cancel</button><button class="s360-btn ' + (d === 'rejected' ? 'danger' : '') + '" type="submit">' + (d === 'approved' ? 'Approve' : 'Reject') + '</button></div></form>');
      return;
    }
    if (a === 'csv') {
      var v = S.data[b.getAttribute('data-k')] && S.data[b.getAttribute('data-k')].v; if (!v) return;
      var lines = [['Staff', 'Date', 'Status', 'Check-in', 'Check-out', 'Late min', 'Early leave min', 'Worked min', 'No check-out']];
      v.rows.forEach(function (r) { (r.days || []).forEach(function (d) { lines.push([r.name, d.date, MARK_LABEL[d.status] || '', d.inHm, d.outHm, d.lateMin || '', d.earlyMin || '', d.workedMin || '', d.incomplete ? 'yes' : '']); }); });
      lines.push([]); lines.push(['Staff', 'Present', 'Half', 'Absent', 'Leave', 'Week off', 'Late', 'Hours']);
      v.rows.forEach(function (r) { lines.push([r.name, r.P, r.H, r.A, r.L, r.W, r.late, (r.workedMin / 60).toFixed(2)]); });
      downloadCsv('staff360-attendance-' + v.from + '-to-' + v.to + '.csv', lines); return;
    }
    if (a === 'basiccsv') { try { var c = HNAttend.csv(b.getAttribute('data-ym')); var blob = new Blob(['﻿' + c], { type: 'text/csv;charset=utf-8' }); var l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = 'attendance-' + b.getAttribute('data-ym') + '.csv'; document.body.appendChild(l); l.click(); setTimeout(function () { l.remove(); }, 500); } catch (x) { toast('Could not download'); } return; }
    if (a === 'ask') return ask(b.getAttribute('data-q'));
    if (a === 'alert') {
      var s = b.getAttribute('data-s');
      var send = function (reason) { call('staff360AlertAction', { id: id, state: s, reason: reason || '' }).then(function () { invalidate('aidash'); toast(s === 'dismissed' ? 'Dismissed' : s === 'reviewed' ? 'Marked reviewed' : 'Re-opened'); render(); }, function (er) { toast(er.message); }); };
      if (s !== 'dismissed') return send('');
      sheet('<h3>Dismiss this pattern?</h3><form data-f="dismiss" data-id="' + esc(id) + '"><label class="s360-fld"><span>Reason (required)</span><textarea class="s360-ta" name="reason" required minlength="3" maxlength="200" placeholder="e.g. Approved late start for exams"></textarea></label><div id="s360-sherr"></div><div class="s360-acts"><span style="flex:1"></span><button type="button" class="s360-btn sec" data-a="sheetclose">Cancel</button><button class="s360-btn" type="submit">Dismiss</button></div></form>');
      return;
    }
    if (a === 'saledit') return salarySheet(id);
    if (a === 'salok') {
      return confirmBox({ title: 'Approve this salary draft?', message: 'Approval only records that you reviewed it. Nothing is paid or filed automatically.', confirmText: 'Approve' }).then(function (ok) {
        if (!ok) return; call('staff360SalarySave', { ym: S.sub.ym || todayLocal().slice(0, 7), staffId: id, approve: true }).then(function () { invalidate('sal:'); invalidate('aidash'); toast('Approved'); render(); }, function (er) { toast(er.message); });
      });
    }
    if (a === 'wapreview') { call('staff360WhatsApp', { op: 'preview' }).then(function (r) { S.sub.waPreview = r.text; render(); }, function (er) { toast(er.message); }); return; }
    if (a === 'waoff') { call('staff360WhatsApp', { op: 'disable' }).then(function () { invalidate('wa'); toast('WhatsApp reports turned off'); render(); }, function (er) { toast(er.message); }); return; }
    if (a === 'buy') return buy(b.getAttribute('data-p'));
  }
  function onChange(e) {
    var t = e.target; if (!t) return;
    var k = t.getAttribute('data-a-sel');
    if (k === 'date') { if (t.value) { S.sub.date = t.value > todayLocal() ? todayLocal() : t.value; render(); } return; }
    if (k === 'per' || k === 'rs' || k === 'from' || k === 'to' || k === 'f' || k === 'ym') { S.sub[k] = t.value; render(); return; }
  }
  function onInput(e) {
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-a-input') === 'mkreason') { S.sub.mkreason = t.value; return; }
    if (t && t.getAttribute && t.getAttribute('data-a-input') === 'q') { S.sub.q = t.value; render(); var q = $('s360-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
  }
  function onSubmit(e) {
    var f = e.target; if (!f || !f.getAttribute) return;
    var kind = f.getAttribute('data-f'); if (!kind) return;
    e.preventDefault();
    var fd = new FormData(f), btn = f.querySelector('[type=submit]');
    var busy = function (on) { if (btn) { btn.disabled = on; } };
    if (kind === 'ask') { var q = String(fd.get('q') || '').trim(); if (q) ask(q); return; }
    if (kind === 'staff') {
      busy(true);
      var sid = f.getAttribute('data-id') || null;
      call('staff360StaffSave', { id: sid, name: fd.get('name'), role: fd.get('role'), phone: fd.get('phone'), salary: Number(fd.get('salary')) || 0,
        dailyWage: Number(fd.get('dailyWage')) || 0, active: !fd.get('inactive'), canLogin: !!fd.get('canLogin') }).then(function () {
        sheetClose(); invalidate('roster'); invalidate('reg:'); if (!sid) track('staff_created', {}); toast('✓ Saved'); render();
      }, function (er) { busy(false); sheetErr('s360-sherr', er); });
      return;
    }
    if (kind === 'shift') {
      busy(true);
      call('staff360SaveShift', { id: f.getAttribute('data-id') || null, name: fd.get('name'), start: fd.get('start'), end: fd.get('end'), graceMin: Number(fd.get('graceMin')) || 0,
        weeklyOff: fd.getAll('wo').map(Number), staffIds: fd.getAll('sid') }).then(function () { sheetClose(); invalidate('shifts'); invalidate('reg:'); toast('✓ Shift saved'); render(); }, function (er) { busy(false); sheetErr('s360-sherr', er); });
      return;
    }
    if (kind === 'decide') {
      busy(true);
      call('staff360DecideRequest', { id: f.getAttribute('data-id'), decision: f.getAttribute('data-d'), note: fd.get('note') }).then(function () {
        sheetClose(); invalidate('req:'); invalidate('audit'); track('leave_request_decided', { decision: f.getAttribute('data-d') }); toast('✓ Saved'); render();
      }, function (er) { busy(false); sheetErr('s360-sherr', er); });
      return;
    }
    if (kind === 'dismiss') {
      busy(true);
      call('staff360AlertAction', { id: f.getAttribute('data-id'), state: 'dismissed', reason: fd.get('reason') }).then(function () { sheetClose(); invalidate('aidash'); toast('Dismissed'); render(); }, function (er) { busy(false); sheetErr('s360-sherr', er); });
      return;
    }
    if (kind === 'salary') {
      busy(true);
      var o = { basis: fd.get('basis'), monthlySalary: fd.get('monthlySalary'), dailyWage: fd.get('dailyWage'), divisor: fd.get('divisor'), overtimeHours: fd.get('overtimeHours'), overtimeRate: fd.get('overtimeRate'), leavePaid: !!fd.get('leavePaid') };
      call('staff360SalarySave', { ym: S.sub.ym || todayLocal().slice(0, 7), staffId: f.getAttribute('data-id'), overrides: o }).then(function () { sheetClose(); invalidate('sal:'); invalidate('aidash'); toast('✓ Draft updated'); render(); }, function (er) { busy(false); sheetErr('s360-sherr', er); });
      return;
    }
    if (kind === 'wa') {
      if (!fd.get('consent')) { $('s360-waerr').innerHTML = '<div class="s360-err" role="alert">Tick the consent box to turn on WhatsApp reports.</div>'; return; }
      busy(true);
      call('staff360WhatsApp', { op: 'save', recipient: fd.get('recipient'), cadence: fd.get('cadence'), sendTime: fd.get('sendTime'), weekday: Number(fd.get('weekday')), consent: true }).then(function (r) {
        invalidate('wa'); track('kingpro_whatsapp_optin_enabled', {}); toast(r.note || '✓ WhatsApp reports on'); render();
      }, function (er) { busy(false); $('s360-waerr').innerHTML = '<div class="s360-err" role="alert">' + esc(er.message) + '</div>'; });
      return;
    }
    if (kind === 'settings') {
      busy(true);
      call('staff360SaveSettings', { timezone: fd.get('timezone'), gpsPolicy: fd.get('gpsPolicy'), minAccuracyM: Number(fd.get('minAccuracyM')), lateThreshold: Number(fd.get('lateThreshold')), mirrorToRegister: !!fd.get('mirrorToRegister') }).then(function (r) {
        if (S.st) S.st.settings = r.settings; busy(false); toast('✓ Settings saved'); render();
      }, function (er) { busy(false); $('s360-seterr').innerHTML = '<div class="s360-err" role="alert">' + esc(er.message) + '</div>'; });
    }
  }

  function ask(q) {
    track('kingpro_ai_query_submitted', {}); // never send the question text to analytics
    S.chat.push({ me: true, text: q }); var slot = { pending: true }; S.chat.push(slot); render();
    call('staff360AIAsk', { question: q }).then(function (r) { slot.pending = false; slot.res = r; render(); }, function (e) { slot.pending = false; slot.err = e.message; render(); });
  }

  function buy(p) {
    track('staff360_upgrade_started', { plan: p });
    var box = $('s360-buymsg');
    if (box) box.innerHTML = '<div class="s360-card" aria-busy="true">Checking payment options…</div>';
    call('staff360CreateOrder', { planId: p }).then(function (r) {
      if (r && r.ok && r.order && r.order.checkoutUrl) { location.href = r.order.checkoutUrl; return; }
      var why = r && r.reason === 'price_not_configured' ? 'The price for this plan has not been set yet.' : 'Online payment for Staff360 is not switched on yet.';
      if (box) box.innerHTML = '<div class="s360-warn">' + why + ' Contact HisaabNow support to activate ' + esc(NEED[p]) + ' for your shop. You have not been charged.</div>';
    }, function (e) {
      if (box) box.innerHTML = '<div class="s360-err">' + esc(e.message) + ' You have not been charged.</div>';
    });
  }

  /* ═══════════════════ EMPLOYEE (Premium+) ═══════════════════ */
  var E = { gps: null, gpsErr: null, phase: 'idle', msg: '', hist: null, tab: 'home' };

  function openEmployee() {
    css();
    var el = $('s360e');
    if (!el) {
      el = document.createElement('div'); el.id = 's360e'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'My attendance');
      el.innerHTML = '<div class="s360-wrap" style="max-width:640px"><div class="s360-hd">' + (SA ? '<button class="s360-x" data-e="menu" aria-label="Account menu">☰</button>' : '<button class="s360-x" data-e="close" aria-label="Close">←</button>') + '<div class="s360-tt"><b>My attendance</b><small id="s360e-sub">Staff360</small></div></div><main id="s360e-main" style="padding:0 16px 40px"></main></div>';
      el.addEventListener('click', onEClick); el.addEventListener('submit', onESubmit);
      document.body.appendChild(el);
    }
    E.tab = 'home'; E.phase = 'idle'; E.msg = ''; E.hist = null;
    eRender();
    loadState(true).then(function () { eRender(); loadHist(); });
  }
  function closeEmployee() { var el = $('s360e'); if (el) el.remove(); }
  function loadHist() {
    if (!has('self_checkin')) return;
    call('staff360MyHistory', { days: 30 }).then(function (h) { E.hist = h; eRender(); }, function (e) { E.hist = { error: e.message }; eRender(); });
  }

  function eRender() {
    var m = $('s360e-main'); if (!m) return;
    if (!S.st && !S.stErr) { m.innerHTML = loading(); return; }
    if (S.stErr) { m.innerHTML = '<div class="s360-err">' + esc(S.stErr.code === 'server-missing' ? 'Self check-in is not set up for this shop yet. Ask your manager to mark your attendance.' : S.stErr.message) + '</div>'; return; }
    if (!has('self_checkin')) { m.innerHTML = '<div class="s360-card s360-empty">Your shop marks attendance for you. Self check-in is available when the shop is on Staff360 Premium.</div>'; return; }
    var me = S.st.me;
    if (!me || me.error) { m.innerHTML = '<div class="s360-err">' + esc(me && me.error || 'Your staff profile was not found.') + '</div>'; return; }
    $('s360e-sub').textContent = me.name + (me.role ? ' · ' + me.role : '');
    m.innerHTML = E.tab === 'req' ? eRequestsHTML() : eHomeHTML(me);
  }

  function eHomeHTML(me) {
    var tp = me.todayPunch, open = me.openYesterday;
    var state = open ? 'in' : !tp ? 'none' : tp.checkOutAt ? 'done' : 'in';
    var shift = me.shift ? me.shift.name + ': ' + me.shift.start + ' – ' + me.shift.end + (me.shift.weeklyOff && me.shift.weeklyOff.length ? ' · Off ' + me.shift.weeklyOff.map(function (d) { return WD[d]; }).join(', ') : '') : 'No shift assigned';
    var cur = open || tp;
    var st = state === 'none' ? 'NOT CHECKED IN' : state === 'in' ? 'CHECKED IN · ' + cur.inHm + (open ? ' (yesterday)' : '') : 'DONE · ' + tp.inHm + ' → ' + tp.outHm + ' · ' + hm(tp.workedMinutes);
    var h = '<div class="s360-card" style="margin-top:4px"><small class="s360-note" style="margin:0">Today’s shift</small><b style="display:block">' + esc(shift) + '</b></div>';
    h += '<div class="s360e-hero"><div class="s360e-st ' + (state === 'in' ? 'in' : '') + '" role="status">' + esc(st) + '</div>';
    if (cur && cur.lateMinutes) h += '<div class="s360-chip late" style="margin-top:8px">' + 'Late by ' + cur.lateMinutes + ' min</div>';
    if (state !== 'done') {
      var lbl = state === 'none' ? 'CHECK IN' : 'CHECK OUT';
      var busy = E.phase === 'locating' || E.phase === 'sending';
      h += '<button class="s360-btn s360e-big ' + (state === 'in' ? 'sec' : '') + '" data-e="punch" data-act="' + (state === 'none' ? 'in' : 'out') + '"' + (busy ? ' disabled aria-busy="true"' : '') + '>' + (E.phase === 'locating' ? 'Getting location…' : E.phase === 'sending' ? 'Saving…' : lbl) + '</button>';
    }
    h += gpsPanel(me) + '</div>';
    if (E.msg) h += '<div class="' + (E.phase === 'ok' ? 's360-ok' : 's360-err') + '" role="alert">' + E.msg + '</div>';
    if (E.phase === 'denied' || E.phase === 'unavailable' || E.phase === 'timeout' || E.phase === 'offline') {
      h += '<div class="s360-acts" style="margin-bottom:12px"><button class="s360-btn" data-e="punch" data-act="' + E.retryAct + '">Try again</button>' +
        (me.gpsPolicy === 'allow_without' && E.phase !== 'offline' ? '<button class="s360-btn sec" data-e="nogps" data-act="' + E.retryAct + '">Continue without location</button>' : '') + '</div>' +
        '<div class="s360-note">Still stuck? Ask your manager to mark your attendance from their phone.</div>';
    }
    h += '<div class="s360-acts" style="margin:8px 0 12px"><button class="s360-btn sec" data-e="tab" data-t="req">My requests</button></div>';
    h += '<div class="s360-h2">Recent attendance</div><div class="s360-card">';
    if (!E.hist) h += '<div class="s360-skel"></div><div class="s360-skel" style="width:70%"></div>';
    else if (E.hist.error) h += '<div class="s360-err">' + esc(E.hist.error) + '</div>';
    else {
      var days = E.hist.row.days.filter(function (d) { return d.status || d.inHm; }).reverse().slice(0, 14);
      h += days.length ? days.map(function (d) { return '<div class="s360-row"><div class="s360-grow"><b>' + esc(fmtDate(d.date)) + '</b><small>' + (d.inHm ? 'In ' + esc(d.inHm) + (d.outHm ? ' → ' + esc(d.outHm) : ' · no check-out') : '') + (d.workedMin ? ' · ' + hm(d.workedMin) : '') + '</small></div>' + (d.status ? '<span class="s360-chip ' + d.status + '">' + MARK_LABEL[d.status] + '</span>' : '') + (d.lateMin ? ' <span class="s360-chip late">late</span>' : '') + '</div>'; }).join('') : '<div class="s360-empty">No attendance yet.</div>';
    }
    h += '</div>' + privacyHTML();
    return h;
  }

  function gpsPanel(me) {
    var line;
    if (E.gps) line = 'Location captured · accuracy ± ' + Math.round(E.gps.accuracy) + ' m · ' + new Date(E.gps.capturedAt - S.skew).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) + (E.gps.accuracy > me.minAccuracyM ? ' · <b>low accuracy</b> (will be flagged)' : '');
    else if (E.phase === 'locating') line = 'Getting location…';
    else line = 'Location permission: ' + (me.gpsPolicy === 'require' ? 'required' : 'requested') + '. Staff360 uses your location only to record attendance at check-in and check-out.';
    return '<div class="s360e-gps"><span aria-hidden="true" style="font-size:18px">📍</span><div>' + line + '</div></div>';
  }

  function getGps() {
    return new Promise(function (res) {
      if (!navigator.geolocation) return res({ err: 'unsupported' });
      navigator.geolocation.getCurrentPosition(function (p) {
        res({ gps: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, capturedAt: (p.timestamp || Date.now()) + S.skew } });
      }, function (er) { res({ err: er && er.code === 1 ? 'denied' : er && er.code === 3 ? 'timeout' : 'unavailable' }); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });
  }

  var GPS_MSG = {
    denied: 'Location permission is blocked. Open your browser or phone settings → Site settings → Location → Allow for this app, then try again.',
    unavailable: 'Your phone could not find your location. Turn on Location / GPS and try again near a window or outdoors.',
    timeout: 'Getting your location took too long. Check that Location is on and try again.',
    unsupported: 'This browser cannot share location.',
    offline: 'You are offline. Check-in needs internet so the time is recorded by the server. Connect and try again.',
  };

  function doPunch(act, skipGps) {
    E.retryAct = act; E.msg = '';
    if (navigator.onLine === false) { E.phase = 'offline'; E.msg = GPS_MSG.offline; eRender(); return; }
    track(act === 'in' ? 'employee_checkin_started' : 'employee_checkout_started', {});
    var step = skipGps ? Promise.resolve({ err: E.gpsErr || 'denied' }) : (E.phase = 'locating', eRender(), getGps());
    step.then(function (g) {
      E.gps = g.gps || null; E.gpsErr = g.err || null;
      if (g.err === 'denied') track('gps_permission_denied', {});
      var me = S.st.me;
      if (!g.gps && !skipGps) {
        E.phase = g.err; E.msg = GPS_MSG[g.err] || GPS_MSG.unavailable;
        if (me.gpsPolicy === 'allow_without') E.msg += ' Your shop allows check-in without location — it will be marked “no GPS”.';
        eRender(); return;
      }
      E.phase = 'sending'; eRender();
      return call('staff360Punch', { action: act, gps: g.gps || null, gpsError: g.err || null, clientTs: Date.now() + S.skew }).then(function (r) {
        E.phase = 'ok';
        E.msg = '✓ ' + (act === 'in' ? 'Check-in' : 'Check-out') + ' recorded at ' + esc(act === 'in' ? r.punch.inHm : r.punch.outHm) + (r.punch[act === 'in' ? 'checkInGps' : 'checkOutGps'] ? ' · location ± ' + r.punch[act === 'in' ? 'checkInGps' : 'checkOutGps'].accuracy + ' m' : ' · no location');
        track(act === 'in' ? 'employee_checkin_success' : 'employee_checkout_success', {});
        return loadState(true).then(function () { eRender(); loadHist(); });
      }, function (er) {
        track('employee_checkin_failed', { reason: String(er.code || '') });
        var msg = er.message;
        if (/^gps_required/.test(msg)) msg = 'Your shop requires location for check-in. ' + (GPS_MSG[msg.split(':')[1]] || '');
        else if (msg === 'already_checked_in') msg = 'You are already checked in.';
        else if (msg === 'already_completed') msg = 'You have already checked in and out today.';
        else if (msg === 'no_open_checkin') msg = 'There is no check-in to close. Check in first, or ask your manager to correct it.';
        E.phase = er.code === 'offline' ? 'offline' : 'error'; E.msg = esc(msg);
        return loadState(true).then(eRender);
      });
    });
  }

  function eRequestsHTML() {
    var h = '<div class="s360-acts" style="margin:6px 0 10px"><button class="s360-btn sec sm" data-e="tab" data-t="home">‹ Back</button></div>';
    h += '<form class="s360-card" data-ef="req"><b>New request</b><div class="s360-grid2" style="margin-top:10px"><label class="s360-fld"><span>Type</span><select class="s360-sel" name="type" data-e-type><option value="leave">Leave</option><option value="correction">Attendance correction</option></select></label><label class="s360-fld"><span>Date</span><input type="date" class="s360-in" name="date" required value="' + todayLocal() + '"></label></div>' +
      '<label class="s360-fld"><span>Leave until (optional, for leave)</span><input type="date" class="s360-in" name="toDate"></label>' +
      '<div class="s360-grid2"><label class="s360-fld"><span>Correct status to (correction)</span><select class="s360-sel" name="status"><option value="">—</option><option value="P">Present</option><option value="H">Half-day</option></select></label><label class="s360-fld"><span>Correct check-in (correction)</span><input type="time" class="s360-in" name="checkIn"></label></div>' +
      '<label class="s360-fld"><span>Correct check-out (correction)</span><input type="time" class="s360-in" name="checkOut"></label>' +
      '<label class="s360-fld"><span>Reason</span><textarea class="s360-ta" name="reason" required minlength="3" maxlength="300"></textarea></label><div id="s360e-rqerr"></div><button class="s360-btn" type="submit">Send request</button></form>';
    h += '<div class="s360-h2">My requests</div><div class="s360-card">';
    var L = E.hist && E.hist.requests || [];
    h += L.length ? L.map(function (r) { return '<div class="s360-row"><div class="s360-grow"><b>' + (r.type === 'leave' ? 'Leave · ' + esc(fmtDate(r.fromDate)) + (r.toDate !== r.fromDate ? ' – ' + esc(fmtDate(r.toDate)) : '') : 'Correction · ' + esc(fmtDate(r.date))) + '</b><small>' + esc(r.reason) + (r.decisionNote ? ' · Manager: “' + esc(r.decisionNote) + '”' : '') + '</small></div><span class="s360-chip ' + (r.status === 'approved' ? 'P' : r.status === 'rejected' ? 'A' : 'H') + '">' + esc(r.status) + '</span></div>'; }).join('') : '<div class="s360-empty">No requests yet.</div>';
    return h + '</div>';
  }

  function onEClick(e) {
    var b = e.target.closest ? e.target.closest('[data-e]') : null; if (!b) return;
    var a = b.getAttribute('data-e');
    if (a === 'close') return closeEmployee();
    if (a === 'menu') { if (window.STAFF360_SHELL) STAFF360_SHELL.menu(); return; }
    if (a === 'newbiz') { sheetClose(); if (window.STAFF360_SHELL && STAFF360_SHELL.newBusiness) STAFF360_SHELL.newBusiness(); return; }
    if (a === 'punch') return doPunch(b.getAttribute('data-act'), false);
    if (a === 'nogps') return doPunch(b.getAttribute('data-act'), true);
    if (a === 'tab') { E.tab = b.getAttribute('data-t'); E.msg = ''; eRender(); }
  }
  function onESubmit(e) {
    var f = e.target; if (!f.getAttribute || f.getAttribute('data-ef') !== 'req') return;
    e.preventDefault();
    var fd = new FormData(f), type = fd.get('type'), btn = f.querySelector('[type=submit]');
    var data = { type: type, reason: fd.get('reason') };
    if (type === 'leave') { data.fromDate = fd.get('date'); data.toDate = fd.get('toDate') || fd.get('date'); }
    else { data.date = fd.get('date'); if (fd.get('status')) data.status = fd.get('status'); if (fd.get('checkIn')) data.checkIn = fd.get('checkIn'); if (fd.get('checkOut')) data.checkOut = fd.get('checkOut'); }
    btn.disabled = true;
    call('staff360SubmitRequest', data).then(function () { track('leave_request_created', { type: type }); toast('✓ Request sent to your manager'); loadHist(); E.tab = 'req'; eRender(); },
      function (er) { btn.disabled = false; var x = $('s360e-rqerr'); if (x) x.innerHTML = '<div class="s360-err" role="alert">' + esc(er.message) + '</div>'; });
  }

  /* ═══════════════ Basic audit hook (called by Step ATT) ═══════════════ */
  var QK = 's360_audit_q';
  function auditQueue() { try { return JSON.parse(localStorage.getItem(QK) || '[]'); } catch (e) { return []; } }
  function auditSave(q) { try { localStorage.setItem(QK, JSON.stringify(q.slice(-200))); } catch (e) {} }
  var flushT = null;
  function flushAudit() {
    clearTimeout(flushT); flushT = null;
    var q = auditQueue(); if (!q.length) return;
    var batch = q.slice(0, 50);
    call('staff360LogManualEdit', { entries: batch }).then(function () {
      auditSave(auditQueue().slice(batch.length)); invalidate('audit');
      if (auditQueue().length) flushT = setTimeout(flushAudit, 500);
    }, function () { /* keep queued; retried on next change or open */ });
  }
  function onManualMark(staffId, date, from, to) {
    if (off() || from === to) return;
    track('attendance_marked_manual', {});
    var q = auditQueue();
    var entry = { staffId: staffId, date: date, from: from || '', to: to || '', reason: '', at: Date.now(), shop: shopId() };
    q.push(entry); auditSave(q);
    // Changing an existing mark → offer an optional reason (FR-08).
    if (from && to !== from) askReason(entry);
    clearTimeout(flushT); flushT = setTimeout(flushAudit, 1500);
  }
  function askReason(entry) {
    var host = $('hnat'); if (!host) return;
    var old = $('s360-reason'); if (old) old.remove();
    var s = document.createElement('div'); s.id = 's360-reason'; s.className = 's360-strip'; s.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9690;max-width:520px;width:calc(100% - 24px);background:#fff;box-shadow:0 8px 28px rgba(0,0,0,.18);cursor:default';
    s.innerHTML = '<div style="flex:1"><b>Reason for change (optional)</b><input class="s360-in" style="margin-top:6px;min-height:38px" maxlength="200" placeholder="e.g. Corrected after call" aria-label="Reason for change"></div><button class="s360-btn sm" type="button">Save</button>';
    var inp = s.querySelector('input'), btn = s.querySelector('button');
    var done = function () {
      var v = String(inp.value || '').trim();
      if (v) { var q = auditQueue(); for (var i = q.length - 1; i >= 0; i--) { if (q[i].at === entry.at && q[i].staffId === entry.staffId) { q[i].reason = v; break; } } auditSave(q); }
      s.remove(); clearTimeout(flushT); flushT = setTimeout(flushAudit, 200);
    };
    btn.addEventListener('click', done); inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') done(); });
    document.body.appendChild(s);
    clearTimeout(flushT); flushT = setTimeout(function () { if (document.body.contains(s)) s.remove(); flushAudit(); }, 12000);
  }

  /* ═══════════════ roster sync ═══════════════
     The app's staff list is local-only (HisaabSync never pushes "staff"), so
     the server would only see staff who have a login. Owners/managers send
     the list (name, role, phone, salary — no other personal data) whenever it
     changes, so reports, AI and salary drafts include everyone. */
  var rosterBusy = false;
  function pushRoster(force) {
    if (SA || rosterBusy || !isManager() || !S.st || S.serverMissing) return;
    var list = staffLocal().map(function (x) {
      return { id: x.id, name: x.name || '', role: x.role || '', phone: x.phoneE164 || x.phone || '', salary: Number(x.salary) || 0, active: x.active !== false };
    });
    var key = 's360_roster_' + shopId();
    var sig = JSON.stringify(list);
    var prev = null; try { prev = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) {}
    if (!force && prev && prev.sig === sig && Date.now() - prev.at < 12 * 3600e3) return;
    rosterBusy = true;
    call('staff360SyncRoster', { staff: list }).then(function () {
      try { localStorage.setItem(key, JSON.stringify({ sig: sig, at: Date.now() })); } catch (e) {}
      if (prev && prev.sig !== sig) S.data = {};
    }, function () {}).then(function () { rosterBusy = false; });
  }

  /* ═══════════════ entry points ═══════════════ */
  function css() {
    if ($('s360-css')) return;
    var l = document.createElement('link'); l.id = 's360-css'; l.rel = 'stylesheet';
    l.href = (window.STAFF360_BASE || './staff360/') + 'staff360.css?v=' + encodeURIComponent(window.HISAABNOW_BUILD || '1');
    document.head.appendChild(l);
  }

  function syncEntries() {
    try {
      var on = eligible();
      // 1) Staff screen card under Step ATT's Attendance entry (owner/manager).
      var at = $('hnat-entry'), mine = $('s360-entry');
      if (on && at && isManager()) {
        if (!mine) {
          mine = document.createElement('div'); mine.id = 's360-entry'; mine.style.cssText = 'padding:0 16px;margin:0 0 4px';
          mine.innerHTML = '<button type="button" class="s360-entry" style="width:100%;display:flex;align-items:center;gap:12px;padding:13px 14px;background:#fff;border:1px solid rgba(10,10,10,.08);border-radius:14px;cursor:pointer;font-family:inherit;text-align:left"><span style="font-size:22px;line-height:1" aria-hidden="true">🧑‍💼</span><span style="flex:1;min-width:0"><span style="display:block;font-size:14.5px;font-weight:800;color:#0A0A0A">Staff360</span><span id="s360-entry-sub" style="display:block;font-size:12.5px;font-weight:600;color:#6B6557;margin-top:1px">Shifts, GPS check-in, reports &amp; AI</span></span><span id="s360-entry-badge" style="font-size:11px;font-weight:800;padding:4px 8px;border-radius:99px;background:#F1F1EE;color:#5E5A50">BASIC</span></button>';
          mine.querySelector('button').addEventListener('click', function () { open('overview'); });
          at.parentNode.insertBefore(mine, at.nextSibling);
        }
        mine.style.display = '';
        var bd = $('s360-entry-badge');
        if (bd && S.st) { var p = plan(); bd.textContent = p === 'kingpro' ? '👑 KING PRO' : p === 'premium' ? 'PREMIUM' : 'BASIC'; bd.style.background = p === 'kingpro' ? '#FFF6DD' : p === 'premium' ? '#E8F3EE' : '#F1F1EE'; bd.style.color = p === 'kingpro' ? '#7A5300' : p === 'premium' ? '#0F5F3F' : '#5E5A50'; }
      } else if (mine) mine.style.display = 'none';

      // 2) Strip inside the Step ATT overlay.
      var hn = $('hnat');
      if (on && hn && !$('s360-strip')) {
        var bdHost = $('hnat-bd');
        if (bdHost && bdHost.parentNode) {
          var b = document.createElement('button'); b.type = 'button'; b.id = 's360-strip'; b.className = 's360-strip';
          b.style.cssText = 'display:flex;align-items:center;gap:10px;background:linear-gradient(135deg,#F2FAF6,#FFF8E6);border:1px solid #D9E9DF;border-radius:14px;padding:11px 13px;margin:0 0 12px;cursor:pointer;width:100%;text-align:left;font-family:inherit';
          b.innerHTML = '<span style="font-size:20px" aria-hidden="true">🧑‍💼</span><span style="flex:1"><b style="display:block;font-size:13.5px">Staff360 · ' + (plan() === 'kingpro' ? '👑 King PRO' : plan() === 'premium' ? 'Premium' : 'Basic') + '</b><small style="display:block;color:#5E5A50;font-size:12px;font-weight:600">Shifts, GPS check-in, reports, activity log &amp; AI Staff Manager</small></span><span aria-hidden="true">›</span>';
          b.addEventListener('click', function () { open('overview'); });
          bdHost.parentNode.insertBefore(b, bdHost);
        }
      }

      // 3) Employee home card (non-manager roles) when the shop is Premium+.
      var home = $('pg-home'), ecard = $('s360-ehome');
      var showE = on && !isManager() && S.st && S.st.role === 'employee' && has('self_checkin') && S.st.me && !S.st.me.error;
      if (showE && home && !ecard) {
        ecard = document.createElement('div'); ecard.id = 's360-ehome'; ecard.style.cssText = 'padding:0 16px;margin:8px 0';
        ecard.innerHTML = '<button type="button" style="width:100%;display:flex;align-items:center;gap:12px;padding:14px;background:#E8F3EE;border:1px solid #CFE6DA;border-radius:14px;cursor:pointer;font-family:inherit;text-align:left"><span style="font-size:22px" aria-hidden="true">📍</span><span style="flex:1"><b style="display:block;font-size:14.5px;color:#0A0A0A">My attendance</b><span id="s360-ehome-sub" style="display:block;font-size:12.5px;font-weight:600;color:#0F5F3F">Check in / check out</span></span><span aria-hidden="true">›</span></button>';
        ecard.querySelector('button').addEventListener('click', openEmployee);
        var hdr = home.querySelector('.hdr');
        if (hdr && hdr.nextSibling) home.insertBefore(ecard, hdr.nextSibling); else home.appendChild(ecard);
      } else if (!showE && ecard) ecard.remove();
      if (showE) {
        var sub = $('s360-ehome-sub'), tp = S.st.me.todayPunch;
        if (sub) sub.textContent = !tp ? 'Not checked in today · tap to check in' : tp.checkOutAt ? 'Done today · ' + tp.inHm + ' → ' + tp.outHm : 'Checked in at ' + tp.inHm + ' · tap to check out';
      }
    } catch (e) { /* never break the host app */ }
  }

  /* Deep link from the website: app.hisaabnow.com/?go=staff360[&view=plans]
     (or #staff360). Kept in sessionStorage so it survives login / OTP / shop
     selection, then opened once the shop and the server role are known. */
  var IK = 's360_intent';
  (function captureIntent() {
    try {
      var q = new URLSearchParams(location.search);
      var go = q.get('go') || (location.hash === '#staff360' ? 'staff360' : '');
      if (go !== 'staff360') return;
      sessionStorage.setItem(IK, q.get('view') || 'overview');
      q.delete('go'); q.delete('view');
      var qs = q.toString();
      history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + (location.hash === '#staff360' ? '' : location.hash));
    } catch (e) {}
  })();
  function consumeIntent() {
    var v = null; try { v = sessionStorage.getItem(IK); } catch (e) {}
    if (!v || !shopId() || !eligible() || !S.stAt) return;
    if ($('s360') || $('s360e') || $('hnat')) return;
    try { sessionStorage.removeItem(IK); } catch (e) {}
    var r = S.st ? S.st.role : (isManager() ? 'owner' : 'employee');
    track('staff360_opened', { from: 'deeplink' });
    if (r === 'employee') openEmployee();
    else open(VIEWS.some(function (x) { return x.id === v; }) ? v : 'overview');
  }

  var lastShop = null, lastRole = null;
  function tick() {
    if (off() || SA) return;
    var sid = shopId(), r = role();
    if (!sid) return;
    if (eligible() && (sid !== lastShop || r !== lastRole || (Date.now() - S.stAt > 10 * 60e3 && !S.busy._st))) {
      lastShop = sid; lastRole = r; S.busy._st = true; S.data = {};
      loadState(true).then(function () { S.busy._st = false; syncEntries(); pushRoster(false); consumeIntent(); if (auditQueue().length) flushAudit(); });
    }
    syncEntries();
    if (!S.busy._st) consumeIntent();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick); else tick();
  setInterval(tick, 2000);
  window.addEventListener('online', function () { if (auditQueue().length) flushAudit(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if ($('s360-sheet')) return sheetClose();
    if ($('s360e')) return closeEmployee();
    if ($('s360') && !$('hnat')) close();
  });

  window.Staff360 = {
    version: '1.0.0', open: open, close: close, openEmployee: openEmployee,
    _onManualMark: onManualMark, _state: function () { return S; }, _flush: flushAudit, _reload: function () { return loadState(true).then(render); },
  };
  try { console.log('[Staff360] loaded — disable with localStorage.setItem("HN_S360","off")'); } catch (e) {}
})();
