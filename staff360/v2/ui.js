/* Staff360 v2 — shared UI helpers: formatting, icons, charts, modal, CSV, view registry. */
(function () {
  'use strict';
  var St = window.S360Store;
  var U = window.S360UI = { views: {}, actions: {}, state: {} };

  // ---------- formatting ----------
  U.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  U.pad = function (n) { return (n < 10 ? '0' : '') + n; };
  U.parse = function (iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  U.iso = function (d) { return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate()); };
  U.addDays = function (iso, n) { var d = U.parse(iso); d.setDate(d.getDate() + n); return U.iso(d); };
  U.toMin = function (t) { if (!t) return null; var p = t.split(':'); return +p[0] * 60 + +p[1]; };
  U.t12 = function (m) { if (m == null || isNaN(m)) return '—'; m = Math.round(m); var h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + ':' + U.pad(mm) + ' ' + ap; };
  U.hm12 = function (t) { return t ? U.t12(U.toMin(t)) : '—'; };
  U.dur = function (m) { if (m == null || isNaN(m)) return '—'; m = Math.round(m); return Math.floor(m / 60) + 'h ' + U.pad(m % 60) + 'm'; };
  U.DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  U.DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  U.MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  U.MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  U.dLabel = function (iso, long) { var d = U.parse(iso); return (long ? U.DOW[d.getDay()] + ', ' : '') + d.getDate() + ' ' + U.MON[d.getMonth()] + (long ? ' ' + d.getFullYear() : ''); };
  U.monthLabel = function (ym) { var p = ym.split('-'); return U.MON_LONG[+p[1] - 1] + ' ' + p[0]; };
  U.inr = function (x) { return '₹' + Math.round(x).toLocaleString('en-IN'); };
  U.inr2 = function (x) { return '₹' + (Math.round(x * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); };
  U.code = function (p) { return p.code || (/^HN\d+$/.test(p.id) ? p.id : String(p.id).replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()); };
  U.joinLabel = function (p, long) { return p.joined ? U.dLabel(p.joined, long) + (long ? '' : ' ' + p.joined.slice(0, 4)) : '—'; };
  U.offLabel = function (p) { return p.weeklyOff == null || p.weeklyOff === '' ? 'None' : U.DOW_LONG[+p.weeklyOff]; };
  U.mobile = function (m) { return m ? m.slice(0, 5) + ' ' + m.slice(5) : '—'; };
  U.initials = function (n) { return n.split(' ').filter(Boolean).map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase(); };
  var AV = [['#E8F0FE', '#2B5FD9'], ['#E7F7F1', '#0B7A57'], ['#F2EDFE', '#6A3FD8'], ['#FEF0E3', '#B35D0B'], ['#FDECE9', '#C03520'], ['#E6F6FB', '#0E7490']];
  U.avatar = function (p, size) {
    var c = AV[(parseInt(String(p.id).replace(/\D/g, ''), 10) || 0) % AV.length];
    return '<span class="avatar" style="background:' + c[0] + ';color:' + c[1] + (size ? ';width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size / 2.7) + 'px' : '') + '" aria-hidden="true">' + U.esc(U.initials(p.name)) + '</span>';
  };
  U.toast = function (msg) {
    var old = document.querySelector('.toast'); if (old) old.remove();
    var t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2800);
  };

  U.STATUS = {
    present: ['Present', 'var(--success)', 'b-green'], late: ['Late', 'var(--warning)', 'b-amber'],
    halfday: ['Half day', 'var(--orange)', 'b-orange'], absent: ['Absent', 'var(--danger)', 'b-red'],
    leave: ['On leave', 'var(--purple)', 'b-purple'], weeklyoff: ['Weekly off', '#98A2B3', 'b-grey'],
    notin: ['Not marked', 'var(--blue)', 'b-blue'],
  };
  U.badge = function (status) { var s = U.STATUS[status]; return s ? '<span class="badge ' + s[2] + '">' + s[0] + '</span>' : '<span class="badge b-blue">Not marked</span>'; };
  U.isIn = function (r) { return !!(r && (r.status === 'present' || r.status === 'late' || r.status === 'halfday') && r.in); };
  U.statusCell = function (r) {
    if (!r) return '<span class="muted">—</span>';
    var s = U.STATUS[r.status] || ['—', '#ccc'];
    return '<span class="st"><i style="background:' + s[1] + '"></i>' + (U.isIn(r) ? U.hm12(r.in) : s[0]) + '</span>';
  };

  // ---------- icons ----------
  var P = U.ICONS = {
    dash: '<rect x="3" y="3" width="7" height="8" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="15" width="7" height="6" rx="2"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.4c1.9.8 3 2.8 3 5.6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.2 3.6-7 8-7s8 2.8 8 7"/>',
    cal: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
    calc: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M8.5 15l2.2 2.2 4.8-4.7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
    leave: '<path d="M4 20c4-1 6-4 6-9V4l4 3 4-3v7c0 5 2 8 2 9"/><path d="M10 13h8"/>',
    bars: '<path d="M5 20v-6M10 20V10M15 20V6M20 20V3M3 21h19"/>',
    crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5z"/><path d="M5 21h14"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.9.7c0 1.7-2.4 2.2-2.4 3.8M12 17h.01"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    chev: '<path d="M6 9l6 6 6-6"/>', left: '<path d="M15 6l-6 6 6 6"/>', right: '<path d="M9 6l6 6-6 6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>', side: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
    userplus: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M19 8v6M16 11h6"/>',
    report: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    store: '<path d="M4 10v10h16V10M2.5 9.5L4.5 4h15l2 5.5c0 1.6-1.3 2.5-2.6 2.5s-2.6-.9-2.6-2.5c0 1.6-1.3 2.5-2.65 2.5S11 11.1 11 9.5c0 1.6-1.3 2.5-2.6 2.5S5.8 11.1 5.8 9.5c0 1.6-1.3 2.5-2.65 2.5"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9"/>',
    alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17h.01"/>',
    pin: '<path d="M12 21.5s7-6.6 7-12a7 7 0 0 0-14 0c0 5.4 7 12 7 12z"/><circle cx="12" cy="9.5" r="2.5"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    spark: '<path d="M12 3l1.9 5.6 5.6 1.9-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9zM19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>', send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>',
    rupee: '<path d="M6.5 4h11M6.5 8.5h11M6.5 4h3.5a4.5 4.5 0 0 1 0 9H6.5l8 7.5"/>', home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    shield: '<path d="M12 2.8l8 3v6.1c0 4.9-3.4 8.3-8 9.3-4.6-1-8-4.4-8-9.3V5.8z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    whatsapp: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9 9.5c.3 2 2.5 4.2 4.5 4.5l1-1.2 1.8.8c-.3 1.2-1.4 1.9-2.6 1.6A7 7 0 0 1 8 9.6c-.2-1.2.5-2.3 1.7-2.6l.8 1.8z"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
  };
  U.ic = function (n, cls) { return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (P[n] || '') + '</svg>'; };
  U.LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="9" y="35" width="10" height="20" rx="3" fill="#078C45"/><rect x="23" y="25" width="10" height="30" rx="3" fill="#078C45"/><rect x="37" y="14" width="10" height="41" rx="3" fill="#078C45"/><path d="M4 56h52" stroke="#078C45" stroke-width="4" stroke-linecap="round"/><path d="M53 5l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#F59E0B"/></svg>';

  // ---------- charts (SVG strings) ----------
  U.ring = function (segs, size, stroke, center) {
    var r = (size - stroke) / 2, c = 2 * Math.PI * r, total = 0, off = 0, out = '';
    segs.forEach(function (s) { total += s[0]; });
    out += '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="#EEF2F6" stroke-width="' + stroke + '"/>';
    if (total > 0) segs.forEach(function (s) {
      if (!s[0]) return;
      var len = c * s[0] / total, gap = segs.length > 1 ? Math.min(3, len / 3) : 0;
      out += '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + s[1] + '" stroke-width="' + stroke + '" stroke-linecap="' + (segs.length > 1 ? 'butt' : 'round') + '" stroke-dasharray="' + Math.max(len - gap, 0.01) + ' ' + c + '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>';
      off += len;
    });
    return '<div class="ring-c" style="width:' + size + 'px;height:' + size + 'px"><svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' + out + '</svg>' + (center ? '<div class="ctr">' + center + '</div>' : '') + '</div>';
  };
  U.pctRing = function (pct, size, stroke, colour) {
    var r = (size - stroke) / 2, c = 2 * Math.PI * r;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true"><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="#EEF2F6" stroke-width="' + stroke + '"/><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + colour + '" stroke-width="' + stroke + '" stroke-linecap="round" stroke-dasharray="' + (c * Math.max(Math.min(pct, 1), 0)) + ' ' + c + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/></svg>';
  };
  // Vertical bar/line trend: pts = [{label, value (0..1), tip}]
  U.trend = function (pts, opts) {
    opts = opts || {};
    var W = 640, H = 200, padL = 34, padB = 26, padT = 10, n = pts.length, bw = (W - padL - 8) / Math.max(n, 1);
    var out = '';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (g) {
      var y = padT + (H - padT - padB) * (1 - g);
      out += '<line x1="' + padL + '" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="#EEF2F6"/><text x="' + (padL - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="#98A2B3">' + Math.round(g * 100) + '%</text>';
    });
    var line = '';
    pts.forEach(function (p, i) {
      var h = (H - padT - padB) * Math.max(0, Math.min(1, p.value)), x = padL + i * bw + bw * 0.18, y = H - padB - h;
      out += '<rect x="' + x + '" y="' + y + '" width="' + bw * 0.64 + '" height="' + Math.max(h, 1) + '" rx="3" fill="' + (p.color || (p.value >= 0.9 ? '#16A779' : p.value >= 0.75 ? '#F5B82E' : '#E94B35')) + '" opacity=".9"><title>' + U.esc(p.tip || '') + '</title></rect>';
      line += (i ? 'L' : 'M') + (x + bw * 0.32) + ' ' + y;
      if (n <= 16 || i % Math.ceil(n / 12) === 0) out += '<text x="' + (x + bw * 0.32) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="#98A2B3">' + U.esc(p.label) + '</text>';
    });
    if (opts.line) out += '<path d="' + line + '" fill="none" stroke="#182B55" stroke-width="1.5" opacity=".5"/>';
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + U.esc(opts.label || 'Chart') + '" preserveAspectRatio="none">' + out + '</svg>';
  };
  // Horizontal bars: rows = [{label, value, max, text, color}]
  U.hbars = function (rows) {
    return '<div class="hbars">' + rows.map(function (r) {
      var w = r.max ? Math.max(0, Math.min(100, r.value / r.max * 100)) : 0;
      return '<div class="hb"><span class="l">' + U.esc(r.label) + '</span><span class="track"><i style="width:' + w + '%;background:' + (r.color || 'var(--primary)') + '"></i></span><b>' + U.esc(r.text) + '</b></div>';
    }).join('') + (rows.length ? '' : '<div class="empty">No data for this filter.</div>') + '</div>';
  };

  // ---------- metrics ----------
  U.worked = function (r) {
    if (r && r.workedMin > 0) return r.workedMin;
    if (!r || !r.in || !r.out) return null;
    var p = St.person(r.staff), sh = (p && St.shift(p.shift)) || { breakMin: 60 };
    return Math.max(U.toMin(r.out) - U.toMin(r.in) - (r.status === 'halfday' ? 0 : sh.breakMin), 0);
  };
  U.avg = function (a) { a = a.filter(function (x) { return x != null && !isNaN(x); }); return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; };
  U.monthStart = function (iso) { return iso.slice(0, 8) + '01'; };
  U.count = function (recs) {
    var c = { present: 0, late: 0, halfday: 0, absent: 0, leave: 0, weeklyoff: 0, notin: 0 };
    recs.forEach(function (r) { if (c[r.status] != null) c[r.status]++; });
    c.workdays = c.present + c.late + c.halfday + c.absent + c.leave;
    c.rate = c.workdays ? (c.present + c.late + c.halfday * 0.5) / c.workdays : null;
    return c;
  };
  U.lateMin = function (r) {
    if (r && r.lateMin != null) return r.lateMin;
    var p = St.person(r.staff), sh = p && St.shift(p.shift);
    return sh && r.in ? U.toMin(r.in) - U.toMin(sh.start) : 0;
  };

  // ---------- modal ----------
  var lastFocus = null;
  U.modal = function (o) {
    U.closeModal();
    lastFocus = document.activeElement;
    var bg = document.createElement('div'); bg.className = 'modal-bg'; bg.id = 's360-modal';
    bg.innerHTML = '<form class="modal' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="s360-mt" novalidate>' +
      '<div class="modal-h"><h2 id="s360-mt">' + o.title + '</h2><button type="button" class="icon-btn" data-m="close" aria-label="Close">' + U.ic('x') + '</button></div>' +
      '<div class="modal-b">' + o.body + '</div>' + (o.foot === false ? '' : '<div class="modal-f">' + (o.foot || '<button type="button" class="btn" data-m="close">Cancel</button><button type="submit" class="btn pri">' + (o.submit || 'Save') + '</button>') + '</div>') + '</form>';
    document.body.appendChild(bg);
    var form = bg.querySelector('form');
    bg.addEventListener('click', function (e) {
      if (e.target === bg || e.target.closest('[data-m="close"]')) { U.closeModal(); return; }
      if (o.onClick) o.onClick(e, form);
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); if (o.onSubmit) o.onSubmit(form); });
    if (o.onChange) form.addEventListener('change', function (e) { o.onChange(e, form); });
    if (o.onInput) form.addEventListener('input', function (e) { o.onInput(e, form); });
    bg.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') { // keep focus inside the dialog
        var f = [].slice.call(form.querySelectorAll('button,input,select,textarea,a[href]')).filter(function (x) { return !x.disabled && x.offsetParent !== null; });
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    var first = form.querySelector('.modal-b input:not([type=hidden]):not([disabled]),.modal-b select,.modal-b textarea') || form.querySelector('button[type=submit]');
    if (first) setTimeout(function () { first.focus(); }, 30);
    return form;
  };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.getElementById('s360-modal')) { e.preventDefault(); U.closeModal(); } });
  U.closeModal = function () {
    var m = document.getElementById('s360-modal'); if (!m) return;
    m.remove(); if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
  };
  U.confirm = function (title, text, okLabel, onOk, danger) {
    U.modal({ title: title, body: '<p>' + text + '</p>', submit: okLabel,
      foot: '<button type="button" class="btn" data-m="close">Cancel</button><button type="submit" class="btn ' + (danger ? 'danger' : 'pri') + '">' + okLabel + '</button>',
      onSubmit: function () { U.closeModal(); onOk(); } });
  };
  // Form field helpers
  U.field = function (label, input, opts) {
    opts = opts || {};
    return '<div class="fld' + (opts.cls ? ' ' + opts.cls : '') + '"><label' + (opts.for ? ' for="' + opts.for + '"' : '') + '>' + label + (opts.req ? ' <span class="req" aria-hidden="true">*</span>' : '') + '</label>' + input +
      (opts.hint ? '<small class="hint">' + opts.hint + '</small>' : '') + '<small class="err" data-err="' + (opts.for || '') + '"></small></div>';
  };
  U.options = function (list, sel) {
    return list.map(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return '<option value="' + U.esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + U.esc(l) + '</option>'; }).join('');
  };
  U.setErr = function (form, name, msg) {
    var e = form.querySelector('[data-err="' + name + '"]'), i = form.querySelector('[name="' + name + '"]');
    if (e) e.textContent = msg || '';
    if (i) { i.setAttribute('aria-invalid', msg ? 'true' : 'false'); }
    return !msg;
  };
  U.val = function (form, name) { var i = form.querySelector('[name="' + name + '"]'); if (!i) return ''; return i.type === 'checkbox' ? i.checked : i.value.trim(); };

  // ---------- CSV ----------
  U.csv = function (filename, rows) {
    var text = rows.map(function (r) { return r.map(function (c) { c = c == null ? '' : String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n');
    var blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    U.toast('Downloaded ' + filename);
  };

  // ---------- shared page bits ----------
  U.pageHead = function (title, sub, actions) {
    return '<div class="page-h"><div><h1>' + title + '</h1>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' + (actions ? '<div class="ph-act">' + actions + '</div>' : '') + '</div>';
  };
  U.kpi = function (icon, label, value, sub, bg, fg) {
    return '<div class="card kpi"><span class="ki" style="background:' + bg + ';color:' + fg + '">' + U.ic(icon) + '</span><div><small>' + label + '</small><b>' + value + '</b>' + (sub ? '<em>' + sub + '</em>' : '') + '</div></div>';
  };
  U.locked = function (feature, title, text) {
    var need = St.needs(feature);
    return '<div class="card placeholder"><span class="ph-ic" style="background:var(--purple-light);color:var(--purple)">' + U.ic('lock') + '</span>' +
      '<h1>' + title + ' is on ' + need + '</h1><p>' + text + '</p>' +
      '<a class="btn pri" href="#/plans">' + U.ic('crown') + 'Upgrade to ' + need + ' — ' + St.priceLabel(need === 'King PRO' ? 'kingpro' : 'premium') + '</a></div>';
  };
  U.lockNote = function (feature, text) { return '<span class="lock-note">' + U.ic('lock') + (text || St.needs(feature)) + '</span>'; };
})();
