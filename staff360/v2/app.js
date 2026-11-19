/* Staff360 v2 — app shell, router and screens (owner/manager). */
(function () {
  'use strict';
  var St = window.S360Store;
  var $ = function (s, r) { return (r || document).querySelector(s); };

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parse(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(isoD, n) { var d = parse(isoD); d.setDate(d.getDate() + n); return iso(d); }
  function toMin(t) { if (!t) return null; var p = t.split(':'); return +p[0] * 60 + +p[1]; }
  function t12(m) { if (m == null) return '—'; m = Math.round(m); var h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + ':' + pad(mm) + ' ' + ap; }
  function dur(m) { if (m == null || isNaN(m)) return '—'; m = Math.round(m); return Math.floor(m / 60) + 'h ' + pad(m % 60) + 'm'; }
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dLabel(isoD, withDow) { var d = parse(isoD); return (withDow ? DOW[d.getDay()] + ', ' : '') + d.getDate() + ' ' + MON[d.getMonth()] + (withDow ? ' ' + d.getFullYear() : ''); }
  function initials(n) { return n.split(' ').map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase(); }
  var AV = [['#E8F0FE', '#2B5FD9'], ['#E7F7F1', '#0B7A57'], ['#F2EDFE', '#6A3FD8'], ['#FEF0E3', '#B35D0B'], ['#FDECE9', '#C03520'], ['#E6F6FB', '#0E7490']];
  function avatar(p, size) {
    var c = AV[(parseInt(p.id.replace(/\D/g, ''), 10) || 0) % AV.length];
    return '<span class="avatar" style="background:' + c[0] + ';color:' + c[1] + (size ? ';width:' + size + 'px;height:' + size + 'px' : '') + '">' + esc(initials(p.name)) + '</span>';
  }
  function toast(msg) {
    var t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600);
  }

  var STATUS = {
    present: ['Present', 'var(--success)', 'b-green'], late: ['Late', 'var(--warning)', 'b-amber'],
    halfday: ['Half day', 'var(--orange)', 'b-orange'], absent: ['Absent', 'var(--danger)', 'b-red'],
    leave: ['On leave', 'var(--purple)', 'b-purple'], weeklyoff: ['Weekly off', '#98A2B3', 'b-grey'],
    notin: ['Not in yet', 'var(--blue)', 'b-blue'],
  };
  function badge(status) { var s = STATUS[status]; return s ? '<span class="badge ' + s[2] + '">' + s[0] + '</span>' : '<span class="muted">—</span>'; }
  function isIn(r) { return r && (r.status === 'present' || r.status === 'late' || r.status === 'halfday') && r.in; }

  // ---------- icons ----------
  var P = {
    dash: '<rect x="3" y="3" width="7" height="8" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="15" width="7" height="6" rx="2"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.4c1.9.8 3 2.8 3 5.6"/>',
    cal: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
    calc: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M8.5 15l2.2 2.2 4.8-4.7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
    leave: '<path d="M4 20c4-1 6-4 6-9V4l4 3 4-3v7c0 5 2 8 2 9"/><path d="M10 13h8"/>',
    bars: '<path d="M5 20v-6M10 20V10M15 20V6M20 20V3M3 21h19"/>',
    crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5z"/><path d="M5 21h14"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.9.7c0 1.7-2.4 2.2-2.4 3.8M12 17h.01"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    chev: '<path d="M6 9l6 6 6-6"/>', menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    side: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
    userplus: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M19 8v6M16 11h6"/>',
    report: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9"/>',
    login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    store: '<path d="M4 10v10h16V10M2.5 9.5L4.5 4h15l2 5.5c0 1.6-1.3 2.5-2.6 2.5s-2.6-.9-2.6-2.5c0 1.6-1.3 2.5-2.65 2.5S11 11.1 11 9.5c0 1.6-1.3 2.5-2.6 2.5S5.8 11.1 5.8 9.5c0 1.6-1.3 2.5-2.65 2.5"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17h.01"/>',
  };
  function ic(n, cls) { return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (P[n] || '') + '</svg>'; }
  var LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="9" y="35" width="10" height="20" rx="3" fill="#078C45"/><rect x="23" y="25" width="10" height="30" rx="3" fill="#078C45"/><rect x="37" y="14" width="10" height="41" rx="3" fill="#078C45"/><path d="M4 56h52" stroke="#078C45" stroke-width="4" stroke-linecap="round"/><path d="M53 5l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#F59E0B"/></svg>';

  // ---------- charts ----------
  // Ring with one or more segments: segs = [[value, colour], …]
  function ring(segs, size, stroke, center) {
    var r = (size - stroke) / 2, c = 2 * Math.PI * r, total = 0, off = 0, out = '';
    segs.forEach(function (s) { total += s[0]; });
    out += '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="#EEF2F6" stroke-width="' + stroke + '"/>';
    if (total > 0) segs.forEach(function (s) {
      if (!s[0]) return;
      var len = c * s[0] / Math.max(total, s.max || total), gap = segs.length > 1 ? Math.min(3, len / 3) : 0;
      out += '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + s[1] + '" stroke-width="' + stroke + '" stroke-linecap="' + (segs.length > 1 ? 'butt' : 'round') + '" stroke-dasharray="' + Math.max(len - gap, 0.01) + ' ' + c + '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>';
      off += len;
    });
    return '<div class="ring-c" style="width:' + size + 'px;height:' + size + 'px"><svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' + out + '</svg>' + (center ? '<div class="ctr">' + center + '</div>' : '') + '</div>';
  }
  function pctRing(pct, size, stroke, colour) {
    var r = (size - stroke) / 2, c = 2 * Math.PI * r;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true"><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="#EEF2F6" stroke-width="' + stroke + '"/><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + colour + '" stroke-width="' + stroke + '" stroke-linecap="round" stroke-dasharray="' + (c * Math.min(pct, 1)) + ' ' + c + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/></svg>';
  }

  // ---------- metrics ----------
  function worked(r) {
    if (!r || !r.in || !r.out) return null;
    var sh = St.shift((St.person(r.staff) || {}).shift) || { breakMin: 60 };
    return Math.max(toMin(r.out) - toMin(r.in) - (r.status === 'halfday' ? 0 : sh.breakMin), 0);
  }
  function avg(a) { a = a.filter(function (x) { return x != null; }); return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; }
  function monthStart(isoD) { return isoD.slice(0, 8) + '01'; }
  function monthStats() {
    var recs = St.range(monthStart(St.today), St.today).filter(function (r) { var p = St.person(r.staff); return p && p.status === 'Active'; });
    var c = { present: 0, late: 0, halfday: 0, absent: 0, leave: 0, weeklyoff: 0 };
    recs.forEach(function (r) { if (c[r.status] != null) c[r.status]++; });
    var done = recs.filter(function (r) { return r.date < St.today; });
    return {
      c: c,
      workdays: c.present + c.late + c.halfday + c.absent + c.leave,
      avgHours: avg(done.map(worked)),
      avgOut: avg(done.filter(function (r) { return r.out && r.status !== 'halfday'; }).map(function (r) { return toMin(r.out); })),
      onTime: (c.present + c.late) ? c.present / (c.present + c.late) : null,
    };
  }

  // ---------- shell ----------
  var NAV = [
    ['dashboard', 'Dashboard', 'dash'], ['staff', 'Staff', 'users'], ['attendance', 'Attendance', 'calc'],
    ['shifts', 'Shifts & Schedules', 'clock', 'shifts'], ['leave', 'Leave Management', 'leave', 'leave'],
    ['reports', 'Reports & Analytics', 'bars'], ['ai', 'AI Staff Manager', 'crown', 'ai', 'PRO'],
    'sep', ['settings', 'Settings', 'gear'], ['plans', 'Subscription', 'star'], ['help', 'Help & Support', 'help'],
  ];
  var ui = { route: 'dashboard', pop: null, collapsed: false, drawer: false, q: '' };
  try { ui.collapsed = localStorage.getItem('s360v2.collapsed') === '1'; } catch (e) { /* ignore */ }

  function sideHTML() {
    var items = NAV.map(function (n) {
      if (n === 'sep') return '<div class="sep" role="separator"></div>';
      var locked = n[3] && !St.can(n[3]);
      return '<a class="nav-i' + (ui.route === n[0] ? ' on' : '') + '" href="#/' + n[0] + '"' + (ui.route === n[0] ? ' aria-current="page"' : '') + ' title="' + n[1] + '">' + ic(n[2]) + '<span class="lbl">' + n[1] + '</span>' +
        (n[4] ? '<span class="tag">' + n[4] + '</span>' : locked ? ic('lock', 'lk') : '') + '</a>';
    }).join('');
    var up = St.plan !== 'kingpro' ? '<div class="upsell"><b>' + ic('crown') + 'King PRO</b><p>AI staff insights, late-arrival alerts and salary estimates. ₹4,999/year.</p><a class="btn pri sm" href="#/plans" style="width:100%">Upgrade plan</a></div>' : '';
    return '<div class="logo">' + LOGO + '<span>HisaabNow<small>Staff360</small></span></div>' +
      '<nav aria-label="Staff360">' + items + '</nav><div class="grow"></div>' + up +
      '<div class="demo-plans"><small>Demo plan (preview only)</small><div>' + ['basic', 'premium', 'kingpro'].map(function (p) { return '<button class="' + (St.plan === p ? 'on' : '') + '" data-a="plan:' + p + '" aria-pressed="' + (St.plan === p) + '">' + St.PLAN_LABEL[p] + '</button>'; }).join('') + '</div></div>';
  }

  function topHTML() {
    var b = St.business, n = St.notifications().length;
    return '<button class="icon-btn burger" data-a="drawer" aria-label="Open menu">' + ic('menu') + '</button>' +
      '<button class="icon-btn collapse-btn" data-a="collapse" aria-label="' + (ui.collapsed ? 'Expand' : 'Collapse') + ' sidebar">' + ic('side') + '</button>' +
      '<div class="anchor shop-a"><button class="pill-btn" data-a="pop:shop" aria-haspopup="true" aria-expanded="' + (ui.pop === 'shop') + '">' + ic('store') + '<span class="t">' + esc(b.name) + '<span class="hide-sm">, ' + esc(b.city) + '</span></span>' + ic('chev') + '</button>' + (ui.pop === 'shop' ? shopPop() : '') + '</div>' +
      '<span class="pill-btn hide-md" style="font-weight:500">' + ic('cal') + dLabel(St.today, true) + '</span>' +
      '<div class="search' + (ui.pop === 'search' ? ' open' : '') + ' anchor"><label class="sr" for="s360-q">Search staff</label>' + ic('search') +
      '<input id="s360-q" type="search" placeholder="Search staff by name, ID or mobile" autocomplete="off" value="' + esc(ui.q) + '"><kbd>/</kbd>' +
      '<button class="icon-btn s-btn" data-a="pop:search" aria-label="Search">' + ic('search') + '</button>' + (ui.pop === 'search' && ui.q ? searchPop() : '') + '</div>' +
      '<div class="anchor hide-sm"><button class="plan-chip" data-a="pop:plan" aria-haspopup="true" title="Demo only: preview each plan">Demo plan: ' + St.PLAN_LABEL[St.plan] + ic('chev') + '</button>' + (ui.pop === 'plan' ? planPop() : '') + '</div>' +
      '<div class="anchor"><button class="icon-btn" data-a="pop:bell" aria-label="Notifications, ' + n + ' new">' + ic('bell') + (n ? '<span class="dot"></span>' : '') + '</button>' + (ui.pop === 'bell' ? bellPop() : '') + '</div>' +
      '<div class="anchor"><button class="pill-btn" style="border:0;padding:0 4px" data-a="pop:me" aria-label="Account menu">' + '<span class="avatar" style="background:var(--primary);color:#fff">' + initials(b.owner) + '</span><span class="hide-sm">' + esc(b.ownerFirst) + '</span>' + ic('chev', 'hide-sm') + '</button>' + (ui.pop === 'me' ? mePop() : '') + '</div>';
  }
  function shopPop() {
    return '<div class="pop" role="menu" style="left:0"><div class="hd">Your businesses</div>' + St.businesses.map(function (x, i) {
      return '<button class="it' + (i === 0 ? ' on' : '') + '" data-a="shop:' + i + '" role="menuitem">' + ic('store') + '<span>' + esc(x.name) + '<small>' + esc(x.city) + (i === 0 ? ' · current' : '') + '</small></span></button>';
    }).join('') + '</div>';
  }
  function planPop() {
    return '<div class="pop" role="menu" style="right:0"><div class="hd">Demo only — preview plan gating</div>' + ['basic', 'premium', 'kingpro'].map(function (p) {
      return '<button class="it' + (St.plan === p ? ' on' : '') + '" data-a="plan:' + p + '" role="menuitemradio" aria-checked="' + (St.plan === p) + '">' + (St.plan === p ? ic('check') : '<span style="width:18px"></span>') + '<span>' + St.PLAN_LABEL[p] + '<small>' + { basic: 'Owner marks attendance', premium: '+ staff check-in, shifts, leave', kingpro: '+ AI, insights, salary estimate' }[p] + '</small></span></button>';
    }).join('') + '</div>';
  }
  function bellPop() {
    return '<div class="pop" role="menu" style="right:0;width:300px"><div class="hd">Notifications</div>' + St.notifications().map(function (n) {
      return '<a class="it" href="' + n.go + '" role="menuitem">' + ic('bell') + '<span>' + esc(n.text) + '<small>' + esc(n.at) + '</small></span></a>';
    }).join('') + '<div class="hd" style="text-transform:none;font-weight:500;letter-spacing:0">Sample notifications · WhatsApp alerts are not sent in this preview</div></div>';
  }
  function mePop() {
    return '<div class="pop" role="menu" style="right:0"><div class="it" style="cursor:default"><span>' + esc(St.business.owner) + '<small>Owner · ' + esc(St.business.name) + '</small></span></div>' +
      '<button class="it" data-a="soon:Employee portal" role="menuitem">' + ic('phone') + '<span>Preview employee portal<small>Next build step</small></span></button>' +
      '<a class="it" href="#/settings" role="menuitem">' + ic('gear') + '<span>Settings</span></a>' +
      '<button class="it" data-a="soon:Sign out" role="menuitem">' + ic('logout') + '<span>Sign out<small>Disabled in the demo</small></span></button></div>';
  }
  function searchPop() {
    var q = ui.q.toLowerCase(), hits = St.staff({ all: true }).filter(function (p) { return (p.name + ' ' + p.id + ' ' + p.mobile + ' ' + p.designation).toLowerCase().indexOf(q) >= 0; }).slice(0, 6);
    return '<div class="pop" role="listbox" style="left:0;right:0">' + (hits.length ? '<div class="hd">Staff</div>' + hits.map(function (p) {
      return '<a class="it" href="#/staff/' + p.id + '" role="option">' + avatar(p, 28) + '<span>' + esc(p.name) + '<small>' + esc(p.id + ' · ' + p.designation) + '</small></span></a>';
    }).join('') : '<div class="empty">No staff match “' + esc(ui.q) + '”</div>') + '</div>';
  }

  // ---------- dashboard ----------
  function statusCell(r, compact) {
    if (!r) return '<span class="muted">—</span>';
    var s = STATUS[r.status] || ['—', '#ccc'];
    var txt = isIn(r) ? t12(toMin(r.in)) : s[0];
    return '<span class="st"><i style="background:' + s[1] + '"></i>' + (compact ? txt : txt) + '</span>';
  }

  function dashboard() {
    var today = St.today, rows = St.day(today), active = rows.length, inactive = St.staff({ all: true }).length - active;
    var cnt = { in: 0, late: 0, absent: 0, leave: 0, weeklyoff: 0, notin: 0 };
    rows.forEach(function (x) {
      var r = x.rec; if (!r) return;
      if (isIn(r)) { cnt.in++; if (r.status === 'late') cnt.late++; } else if (cnt[r.status] != null) cnt[r.status]++;
    });
    var scheduled = active - cnt.weeklyoff - cnt.leave, pct = scheduled ? cnt.in / scheduled : 0;
    var ms = monthStats(), pend = St.leaves().filter(function (l) { return l.status === 'Pending'; });
    var todayIn = rows.filter(function (x) { return isIn(x.rec); });
    var avgIn = avg(todayIn.map(function (x) { return toMin(x.rec.in); }));
    var hr = new Date().getHours(), greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    var canCI = St.can('checkin_metrics');

    var h = '<div class="page-h"><div><h1>' + greet + ', ' + esc(St.business.ownerFirst) + '!</h1><p>' +
      (pend.length ? '<a href="#/leave">' + pend.length + ' leave request' + (pend.length > 1 ? 's' : '') + ' pending</a> · ' : '') +
      (cnt.late && canCI ? cnt.late + ' late arrival' + (cnt.late > 1 ? 's' : '') + ' today · ' : '') + 'Here’s your team today.</p></div>' +
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="sample">' + ic('alert') + 'Sample data</span>' +
      '<div class="clock"><div><small>Current time</small><b id="s360-clock">' + dLabel(today, false) + ', ' + t12(new Date().getHours() * 60 + new Date().getMinutes()) + '</b></div>' + ic('clock') + '</div></div></div>';

    h += '<div class="qa">' + [
      ['userplus', 'Add Employee', 'nav:staff', 'var(--blue-light)', 'var(--blue)'],
      ['calc', 'Mark Attendance', 'nav:attendance', 'var(--primary-light)', 'var(--primary)'],
      ['eye', 'View Attendance', 'nav:attendance', 'var(--purple-light)', 'var(--purple)'],
      ['report', 'Generate Report', 'nav:reports', 'var(--orange-light)', 'var(--orange)'],
    ].map(function (q) { return '<button data-a="' + q[2] + '"><span class="qi" style="background:' + q[3] + ';color:' + q[4] + '">' + ic(q[0]) + '</span>' + q[1] + '</button>'; }).join('') + '</div>';

    h += '<div class="kpis">' + [
      ['users', 'Total Staff', active, inactive ? inactive + ' inactive' : 'All active', 'var(--blue-light)', 'var(--blue)'],
      ['check', 'Present Today', cnt.in, !canCI ? 'Marked by owner' : cnt.late ? cnt.late + ' late' : 'All on time', 'var(--success-light)', 'var(--success)'],
      ['x', 'Absent Today', cnt.absent, cnt.notin ? cnt.notin + ' not in yet' : '—', 'var(--danger-light)', 'var(--danger)'],
      ['leave', 'On Leave', cnt.leave, cnt.weeklyoff + ' on weekly off', 'var(--orange-light)', 'var(--orange)'],
    ].map(function (k) { return '<div class="card kpi"><span class="ki" style="background:' + k[4] + ';color:' + k[5] + '">' + ic(k[0]) + '</span><div><small>' + k[1] + '</small><b>' + k[2] + '</b><em>' + k[3] + '</em></div></div>'; }).join('') + '</div>';

    // Row: today ring · mini metrics · month donut
    var notIn = rows.filter(function (x) { return x.rec && (x.rec.status === 'absent' || x.rec.status === 'notin'); });
    h += '<div class="row r-top">';
    h += '<section class="card today"><div class="card-h"><h2>Today</h2>' + (notIn.length ? '<span class="badge b-red">' + notIn.length + ' not in</span>' : '<span class="badge b-green">Everyone in</span>') + '</div>' +
      '<div class="body"><div style="flex:1;min-width:0"><p>' + cnt.in + ' of ' + scheduled + ' scheduled staff have checked in.</p>' +
      '<p class="big">' + (notIn.length ? 'Waiting for: ' + notIn.slice(0, 3).map(function (x) { return esc(x.person.name.split(' ')[0]); }).join(', ') + (notIn.length > 3 ? ' +' + (notIn.length - 3) : '') : 'No one is missing.') + '</p></div>' +
      ring([[cnt.in, 'var(--success)'], [Math.max(scheduled - cnt.in, 0), '#F5B82E']], 120, 12, '<b>' + Math.round(pct * 100) + '%</b><small>present</small>') + '</div>' +
      '<button class="btn pri" data-a="nav:attendance" style="margin-top:14px;width:100%">' + ic('calc') + 'Mark attendance</button></section>';

    var minis = [
      ['clock', 'Average hours', dur(ms.avgHours), 'var(--blue-light)', 'var(--blue)'],
      ['login', 'Average check-in today', t12(avgIn), 'var(--primary-light)', 'var(--primary)'],
      ['target', 'On-time arrival', ms.onTime == null ? '—' : (Math.round(ms.onTime * 1000) / 10) + '%', 'var(--success-light)', 'var(--success)', 1],
      ['logout', 'Average check-out', t12(ms.avgOut), 'var(--orange-light)', 'var(--orange)'],
    ];
    h += '<div class="mini">' + minis.map(function (m) {
      return '<div class="card' + (canCI ? '' : ' locked') + '"><span class="mi" style="background:' + m[3] + ';color:' + m[4] + '">' + ic(m[0]) + '</span><small>' + m[1] + '</small><b' + (m[5] ? ' class="good"' : '') + '>' + m[2] + '</b>' +
        (canCI ? '' : '<div class="veil">' + ic('lock') + '<b>Premium</b>Needs staff check-in</div>') + '</div>';
    }).join('') + '</div>';

    var c = ms.c, rate = ms.workdays ? (c.present + c.late + c.halfday * 0.5) / ms.workdays : 0;
    var segs = [['On time', c.present, 'var(--success)'], ['Late', c.late, 'var(--warning)'], ['Half day', c.halfday, 'var(--orange)'], ['Absent', c.absent, 'var(--danger)'], ['On leave', c.leave, 'var(--purple)']];
    h += '<section class="card donut-card"><div class="card-h"><h2>Attendance this month</h2><a href="#/reports">View stats</a></div><div class="donut-wrap"><ul>' +
      segs.map(function (s) { return '<li><span><i class="dot-s" style="background:' + s[2] + '"></i>' + s[0] + '</span><b>' + s[1] + '</b></li>'; }).join('') + '</ul>' +
      ring(segs.map(function (s) { return [s[1], s[2]]; }), 132, 14, '<b>' + Math.round(rate * 100) + '%</b><small>attendance<br>' + ms.workdays + ' staff-days</small>') + '</div></section>';
    h += '</div>';

    // Row: team table · working history
    var past = [1, 2].map(function (n) { return addDays(today, -n); });
    h += '<div class="row r-2"><section class="card"><div class="card-h"><h2>My Team</h2><a href="#/attendance">View all</a></div>' +
      '<div class="legend">' + ['present', 'late', 'halfday', 'absent', 'leave', 'weeklyoff'].map(function (k) { return '<span><i style="background:' + STATUS[k][1] + '"></i>' + STATUS[k][0] + '</span>'; }).join('') + '</div>' +
      '<div class="tbl-wrap"><table class="t"><thead><tr><th>Member</th><th>Today</th>' + past.map(function (d) { return '<th>' + dLabel(d) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.slice(0, 7).map(function (x) {
        return '<tr><td><a class="who" href="#/staff/' + x.person.id + '">' + avatar(x.person) + '<span><b>' + esc(x.person.name) + '</b><small>' + esc(x.person.designation) + ' · ' + x.person.id + '</small></span></a></td><td>' + statusCell(x.rec) + '</td>' +
          past.map(function (d) { return '<td>' + statusCell(St.record(x.person.id, d)) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div></section>';

    var hist = [0, 1, 2, 3, 4, 5].map(function (n) {
      var d = addDays(today, -n), recs = St.day(d).map(function (x) { return x.rec; }).filter(Boolean);
      var ins = recs.filter(isIn), sched = recs.filter(function (r) { return r.status !== 'weeklyoff' && r.status !== 'leave'; }).length;
      return { d: d, ins: ins.length, sched: sched, arr: avg(ins.map(function (r) { return toMin(r.in); })), dep: avg(ins.filter(function (r) { return r.out; }).map(function (r) { return toMin(r.out); })), hrs: avg(ins.map(worked)) };
    });
    h += '<section class="card"><div class="card-h"><h2>Working History</h2><a href="#/attendance">Open register</a></div>' +
      '<div class="legend"><span><i style="background:var(--success)"></i>8h+ average</span><span><i style="background:var(--warning)"></i>Under 8h</span><span><i style="background:var(--blue)"></i>Day in progress</span></div>' +
      '<div class="tbl-wrap"><table class="t"><thead><tr><th>Date</th><th>Present</th><th>Avg arrival</th><th>Avg departure</th><th style="text-align:right">Avg effective time</th></tr></thead><tbody>' +
      hist.map(function (x, i) {
        var live = i === 0, col = live ? 'var(--blue)' : (x.hrs || 0) >= 480 ? 'var(--success)' : 'var(--warning)';
        return '<tr><td><b style="color:var(--heading)">' + (live ? 'Today' : dLabel(x.d)) + '</b><br><small class="muted">' + DOW[parse(x.d).getDay()] + '</small></td><td>' + x.ins + '/' + x.sched + '</td><td>' + t12(x.arr) + '</td><td>' + (live && !x.dep ? '<span class="muted">Still in store</span>' : t12(x.dep)) + '</td>' +
          '<td><div class="hours"><span>' + (live ? '<span class="muted">In progress</span>' : dur(x.hrs) + '<br><small class="muted">of 8h</small>') + '</span>' + pctRing(live ? 0.5 : (x.hrs || 0) / 480, 26, 4, col) + '</div></td></tr>';
      }).join('') + '</tbody></table></div></section></div>';

    // Row: late arrivals · pending leave · weekly offs
    var lates = rows.filter(function (x) { return x.rec && x.rec.status === 'late'; });
    h += '<div class="row r-3"><section class="card"><div class="card-h"><h2>Late arrivals today</h2><span class="badge b-amber">' + lates.length + '</span></div>' +
      (lates.length ? '<ul class="list">' + lates.map(function (x) {
        var sh = St.shift(x.person.shift), mins = toMin(x.rec.in) - toMin(sh.start);
        return '<li>' + avatar(x.person) + '<span class="grow"><b>' + esc(x.person.name) + '</b><small>' + sh.name + ' shift · in at ' + t12(toMin(x.rec.in)) + '</small></span><span class="badge b-amber">+' + mins + ' min</span></li>';
      }).join('') + '</ul>' : '<div class="empty">No late arrivals today.</div>') +
      (canCI ? '' : '<p class="muted" style="font-size:12px;margin-top:8px">' + ic('lock') + ' Late times come from staff check-in (Premium).</p>') + '</section>';

    h += '<section class="card"><div class="card-h"><h2>Pending leave requests</h2><a href="#/leave">View all</a></div>' +
      (pend.length ? '<ul class="list">' + pend.map(function (l) {
        var p = St.person(l.staff);
        return '<li>' + avatar(p) + '<span class="grow"><b>' + esc(p.name) + '</b><small>' + l.type + ' · ' + dLabel(l.from) + (l.days > 1 ? ' – ' + dLabel(l.to) : '') + ' · ' + l.days + ' day' + (l.days > 1 ? 's' : '') + '</small></span>' +
          '<span class="act"><button class="ok" data-a="leave:' + l.id + ':Approved" aria-label="Approve leave for ' + esc(p.name) + '">' + ic('check') + '</button><button class="no" data-a="leave:' + l.id + ':Rejected" aria-label="Reject leave for ' + esc(p.name) + '">' + ic('x') + '</button></span></li>';
      }).join('') + '</ul>' : '<div class="empty">' + ic('check') + '<br>All caught up — no pending requests.</div>') + '</section>';

    var offs = [];
    for (var n = 1; n <= 7 && offs.length < 6; n++) {
      var d = addDays(today, n), dow = parse(d).getDay();
      St.staff().forEach(function (p) { if (p.weeklyOff === dow && offs.length < 6) offs.push({ p: p, d: d }); });
    }
    h += '<section class="card"><div class="card-h"><h2>Upcoming weekly offs</h2><a href="#/shifts">Schedules</a></div><ul class="list">' +
      offs.map(function (o) { return '<li>' + avatar(o.p) + '<span class="grow"><b>' + esc(o.p.name) + '</b><small>' + esc(o.p.designation) + '</small></span><span class="badge b-grey">' + DOW[parse(o.d).getDay()] + ', ' + dLabel(o.d) + '</span></li>'; }).join('') +
      '</ul></section></div>';
    return h;
  }

  // ---------- placeholder / locked screens ----------
  var NEXT = {
    staff: ['users', 'Staff Directory & Employee Profile', 'Search, filters, add/edit/deactivate employees and full employee profiles.'],
    attendance: ['calc', 'Attendance Register', 'List and calendar views, mark and correct attendance, bulk marking and remarks.'],
    shifts: ['clock', 'Shifts & Schedules', 'Create shifts, assign staff, weekly offs and a weekly calendar.'],
    leave: ['leave', 'Leave Management', 'Leave KPIs, approve/reject, request details and history.'],
    reports: ['bars', 'Reports & Analytics', 'Trends, designation-wise attendance, late arrivals and CSV export.'],
    ai: ['crown', 'AI Staff Manager', 'Suggested questions, simulated chat, insight cards and the salary estimator.'],
    settings: ['gear', 'Settings', 'Business profile, attendance rules, permissions and notifications.'],
    plans: ['star', 'Subscription', 'Compare plans and upgrade. King PRO is ₹4,999/year.'],
    help: ['help', 'Help & Support', 'Guides and WhatsApp support.'],
  };
  var GATE = { shifts: 'shifts', leave: 'leave', ai: 'ai' };
  function placeholder(route) {
    var n = NEXT[route.split('/')[0]] || NEXT.help;
    var gate = GATE[route];
    if (gate && !St.can(gate)) {
      return '<div class="card placeholder"><span class="ki" style="display:inline-flex;width:56px;height:56px;border-radius:16px;align-items:center;justify-content:center;background:var(--purple-light);color:var(--purple)">' + ic('lock') + '</span>' +
        '<h1>' + n[1] + ' is on ' + St.needs(gate) + '</h1><p>' + n[2] + '</p>' +
        '<a class="btn pri" href="#/plans">' + ic('crown') + 'Upgrade to ' + St.needs(gate) + (St.needs(gate) === 'King PRO' ? ' — ₹4,999/year' : '') + '</a></div>';
    }
    return '<div class="card placeholder"><span style="display:inline-flex;width:56px;height:56px;border-radius:16px;align-items:center;justify-content:center;background:var(--primary-light);color:var(--primary)">' + ic(n[0]) + '</span>' +
      '<h1>' + n[1] + '</h1><p>' + n[2] + '<br><b>Coming in the next build step</b> — this preview covers the app shell and dashboard.</p><a class="btn" href="#/dashboard">Back to dashboard</a></div>';
  }

  // ---------- render ----------
  var root;
  function render() {
    root.className = 'app' + (ui.collapsed ? ' collapsed' : '') + (ui.drawer ? ' drawer' : '');
    var focusQ = document.activeElement && document.activeElement.id === 's360-q';
    var caret = focusQ ? document.activeElement.selectionStart : 0;
    root.innerHTML = '<aside class="side" id="s360-side">' + sideHTML() + '</aside><div class="scrim" data-a="drawer"></div>' +
      '<div class="main"><header class="top">' + topHTML() + '</header><main class="content" id="s360-main" tabindex="-1">' +
      (ui.route === 'dashboard' ? dashboard() : placeholder(ui.route)) + '</main></div>';
    if (focusQ) { var q = $('#s360-q'); q.focus(); try { q.setSelectionRange(caret, caret); } catch (e) { /* ignore */ } }
  }
  function route() {
    var r = (location.hash.replace(/^#\/?/, '') || 'dashboard');
    ui.route = r; ui.pop = null; ui.drawer = false; ui.q = '';
    render(); window.scrollTo(0, 0);
  }

  function onClick(e) {
    var t = e.target.closest('[data-a]');
    if (!t) { if (ui.pop && !e.target.closest('.pop')) { ui.pop = null; render(); } return; }
    var a = t.getAttribute('data-a'), parts = a.split(':');
    if (a === 'drawer') { ui.drawer = !ui.drawer; render(); return; }
    if (a === 'collapse') { ui.collapsed = !ui.collapsed; try { localStorage.setItem('s360v2.collapsed', ui.collapsed ? '1' : '0'); } catch (x) { /* ignore */ } render(); return; }
    if (parts[0] === 'pop') { ui.pop = ui.pop === parts[1] ? null : parts[1]; render(); if (ui.pop === 'search') { var q = $('#s360-q'); if (q) q.focus(); } return; }
    if (parts[0] === 'nav') { location.hash = '#/' + parts[1]; return; }
    if (parts[0] === 'plan') { St.setPlan(parts[1]); ui.pop = null; toast('Previewing ' + St.PLAN_LABEL[parts[1]] + ' (demo only)'); return; }
    if (parts[0] === 'shop') { ui.pop = null; render(); if (parts[1] !== '0') toast('Switching business is connected in the live build'); return; }
    if (parts[0] === 'leave') {
      var l = St.leaves().filter(function (x) { return x.id === parts[1]; })[0], p = St.person(l.staff);
      if (!St.can('leave')) { toast('Leave approvals are on Premium'); return; }
      St.decideLeave(parts[1], parts[2]); toast((parts[2] === 'Approved' ? 'Approved' : 'Rejected') + ' leave for ' + p.name); return;
    }
    if (parts[0] === 'soon') { ui.pop = null; render(); toast(parts[1] + ' — coming in a later build step'); return; }
  }
  function onInput(e) {
    if (e.target.id === 's360-q') { ui.q = e.target.value; ui.pop = 'search'; render(); }
  }
  function onKey(e) {
    if (e.key === 'Escape' && (ui.pop || ui.drawer)) { ui.pop = null; ui.drawer = false; ui.q = ''; render(); }
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); ui.pop = 'search'; render(); var q = $('#s360-q'); if (q) q.focus(); }
  }

  function start() {
    root = document.getElementById('s360v2');
    St.subscribe(render);
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', route);
    setInterval(function () { var c = $('#s360-clock'); if (c) c.textContent = dLabel(St.today, false) + ', ' + t12(new Date().getHours() * 60 + new Date().getMinutes()); }, 30000);
    route();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
