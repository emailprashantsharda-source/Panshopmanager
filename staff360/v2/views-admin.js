/* Staff360 v2 — Settings, Subscription and Help & Support. */
(function () {
  'use strict';
  var St = window.S360Store, U = window.S360UI, esc = U.esc, ic = U.ic;
  var WA = 'https://wa.me/917838361200?text=';

  function toggle(name, label, on, hint, feature) {
    var locked = feature && !St.can(feature);
    return '<div class="set-row"><div><b>' + label + '</b>' + (hint ? '<small>' + hint + '</small>' : '') + '</div>' +
      (locked ? U.lockNote(feature) : '<label class="switch"><input type="checkbox" name="' + name + '"' + (on ? ' checked' : '') + '><span></span><span class="sr">' + label + '</span></label>') + '</div>';
  }

  U.views.settings = function () {
    var s = St.settings(), b = s.business, r = s.rules;
    var h = U.pageHead('Settings', 'Business profile, attendance rules, permissions and notifications.');
    if (St.live && St.role !== 'owner') return h + '<div class="card placeholder"><span class="ph-ic" style="background:var(--blue-light);color:var(--blue)">' + ic('lock') + '</span><h1>Only the owner can change settings</h1><p>Ask the owner if something needs to change.</p></div>';
    h += '<div class="set-grid">';
    if (St.live) {
      var shop = St.kind === 'shop';
      h += '<form class="card" data-set="business" novalidate><div class="card-h"><h2>' + ic('store') + 'Business profile</h2></div>' +
        U.field('Business name', '<input id="s-bn" name="name" value="' + esc(b.name) + '" maxlength="60"' + (shop ? ' disabled' : '') + '>', { for: 'name', req: !shop, hint: shop ? 'This is your HisaabNow shop — rename it in the HisaabNow app.' : '' }) +
        (shop ? '' : '<div class="form-f"><button class="btn pri" type="submit">Save profile</button></div>') + '</form>';
    } else
    h += '<form class="card" data-set="business" novalidate><div class="card-h"><h2>' + ic('store') + 'Business profile</h2></div><div class="grid2">' +
      U.field('Business name', '<input id="s-bn" name="name" value="' + esc(b.name) + '" maxlength="60">', { for: 'name', req: true }) +
      U.field('City / area', '<input id="s-bc" name="city" value="' + esc(b.city) + '" maxlength="40">', { for: 'city' }) +
      U.field('Owner name', '<input id="s-bo" name="owner" value="' + esc(b.owner) + '" maxlength="40">', { for: 'owner', req: true }) +
      U.field('Business phone', '<input id="s-bp" name="phone" value="' + esc(b.phone) + '" inputmode="numeric" maxlength="10">', { for: 'phone' }) +
      '</div><div class="form-f"><button class="btn pri" type="submit">Save profile</button></div></form>';

    var lockSet = !St.can('settings'), fs0 = lockSet ? '<fieldset disabled class="locked-set">' : '', fs1 = lockSet ? '</fieldset>' : '';
    var saveBtn = function (label) { return lockSet ? '<div class="form-f">' + U.lockNote('settings', 'Premium — <a href="#/plans">upgrade</a> to change') + '</div>' : '<div class="form-f"><button class="btn pri" type="submit">' + label + '</button></div>'; };
    h += '<form class="card" data-set="rules" novalidate><div class="card-h"><h2>' + ic('clock') + 'Attendance rules</h2></div>' + fs0 + '<div class="grid2">' +
      U.field('Default grace period (min)', '<input id="s-rg" name="graceMin" type="number" min="0" max="120" value="' + r.graceMin + '">', { for: 'graceMin', hint: 'Used for new shifts' }) +
      U.field('Working hours per day', '<input id="s-rh" name="hoursPerDay" type="number" min="1" max="16" step="0.5" value="' + r.hoursPerDay + '">', { for: 'hoursPerDay', hint: 'For hourly rate and overtime' }) +
      U.field('Half day if worked under (hours)', '<input id="s-rhd" name="halfDayBelowHours" type="number" min="1" max="12" step="0.5" value="' + r.halfDayBelowHours + '">', { for: 'halfDayBelowHours' }) +
      (St.live ? '' : U.field('Default weekly off', '<select id="s-rwo" name="defaultWeeklyOff">' + U.options(U.DOW_LONG.map(function (d, i) { return [i, d]; }), s.defaultWeeklyOff) + '</select>', { for: 'defaultWeeklyOff' })) + '</div>' +
      toggle('autoLate', 'Mark Late automatically', r.autoLate, 'Check-in after shift start + grace is marked Late') +
      toggle('autoHalfDay', 'Mark Half day automatically', r.autoHalfDay, 'When someone checks out after working less than the half-day hours above. Days you marked by hand are never changed.', 'employee_login') +
      toggle('autoAbsent', 'Mark no-shows Absent at the end of the day', r.autoAbsent, 'After 11 pm: staff who check in on their phone but didn’t, and aren’t on a weekly off or approved leave', 'employee_login') +
      (St.live ? '<div class="set-row"><div><b>Location at check-in</b><small>Captured only at the moment of check-in and check-out — never in the background.</small></div><span class="badge b-green">On</span></div>' :
      toggle('gpsRequired', 'Capture location at check-in', r.gpsRequired, 'Only at the moment of check-in and check-out — never in the background', 'gps')) +
      toggle('allowNoGps', 'Allow check-in when location is off', r.allowNoGps, 'Saved as “No GPS” so you can see it', 'gps') +
      fs1 + saveBtn('Save rules') + '</form>';

    h += fenceCard(fs0, fs1, saveBtn);
    h += '<form class="card" data-set="perms" novalidate><div class="card-h"><h2>' + ic('shield') + 'Employee permissions</h2></div>' + fs0 +
      '<div class="set-row"><div><b>Employees see only their own attendance</b><small>Always on. They never see billing, sales, other staff, salaries or reports.</small></div><span class="badge b-green">Always</span></div>' +
      toggle('requestLeave', 'Employees can request leave', s.perms.requestLeave, '', 'leave') +
      toggle('seeShift', 'Employees can see their shift', s.perms.seeShift, '', 'shifts') +
      toggle('managerEdit', 'Managers can mark and correct attendance', s.perms.managerEdit, 'Every change is logged with a reason') +
      toggle('managerSalary', 'Managers can see salaries', s.perms.managerSalary, 'Off by default — salary is owner-only') +
      fs1 + saveBtn('Save permissions') + '</form>';

    h += '<form class="card" data-set="notify" novalidate><div class="card-h"><h2>' + ic('bell') + 'Notifications</h2></div>' + fs0 +
      toggle('leaveAlert', 'New leave requests', s.notify.leaveAlert, 'In-app notification', 'leave') +
      toggle('lateAlert', 'Repeated late arrivals', s.notify.lateAlert, 'In-app alert when someone is late 3 times in a month', 'anomalies') +
      toggle('dailySummary', 'Daily attendance summary on WhatsApp', s.notify.dailySummary, 'Only after you opt in and WhatsApp is set up. Not sent in this preview.', 'whatsapp') +
      fs1 + saveBtn('Save notifications') + '</form>';

    h += waCard();
    h += '<section class="card"><div class="card-h"><h2>' + ic('star') + 'Subscription &amp; billing</h2></div><div class="set-row"><div><b>Current plan: ' + St.PLAN_LABEL[St.plan] + '</b><small>Plans are per business. King PRO is ₹4,999/year.</small></div><a class="btn" href="#/plans">Manage plan</a></div>' +
      (St.live ? '' : '<div class="set-row"><div><b>Reset demo data</b><small>Puts the sample team and attendance back the way they started.</small></div><button class="btn danger-o" data-a="demo-reset">Reset</button></div>') + '</section>';
    return h + '</div>';
  };
  // ---------- shop location (shop-distance check) ----------
  function fenceCard(fs0, fs1, saveBtn) {
    var g = St.settings().fence || {}, has = g.lat != null && g.lat !== '';
    return '<form class="card" data-set="fence" novalidate><div class="card-h"><h2>' + ic('pin') + 'Shop location</h2></div>' + fs0 +
      '<p class="muted small" style="margin:-6px 0 12px">Check if staff are at the shop when they check in. Their location is read only at that moment.</p>' +
      '<div class="grid2">' + U.field('Latitude', '<input id="s-glat" name="lat" inputmode="decimal" value="' + (has ? g.lat : '') + '" placeholder="e.g. 28.5355">', { for: 'lat' }) +
      U.field('Longitude', '<input id="s-glng" name="lng" inputmode="decimal" value="' + (has ? g.lng : '') + '" placeholder="e.g. 77.3910">', { for: 'lng' }) + '</div>' +
      '<p style="margin:-4px 0 12px"><button type="button" class="btn sm" data-a="fence-here">' + ic('pin') + 'Use my current location</button> <small class="muted" id="s-gnote">Stand inside the shop when you tap this.</small></p>' +
      '<div class="grid2">' + U.field('Allowed distance (metres)', '<input id="s-grad" name="radiusM" type="number" min="50" max="5000" step="10" value="' + (g.radiusM || 200) + '">', { for: 'radiusM', hint: '100–300 m suits most shops' }) +
      U.field('If someone checks in farther away', '<select id="s-gmode" name="mode">' + U.options([['off', 'Don’t check'], ['flag', 'Allow, but flag it for me'], ['block', 'Don’t allow the check-in']], g.mode || 'off') + '</select>', { for: 'mode' }) + '</div>' +
      fs1 + saveBtn('Save location') + '</form>';
  }
  U.actions['fence-here'] = function () {
    var note = document.getElementById('s-gnote');
    if (!navigator.geolocation) { if (note) note.textContent = 'This browser can’t share location.'; return; }
    if (note) note.textContent = 'Getting your location…';
    navigator.geolocation.getCurrentPosition(function (p) {
      document.getElementById('s-glat').value = Math.round(p.coords.latitude * 1e6) / 1e6;
      document.getElementById('s-glng').value = Math.round(p.coords.longitude * 1e6) / 1e6;
      if (note) note.textContent = 'Got it (±' + Math.round(p.coords.accuracy) + ' m). Now save.';
      var m = document.getElementById('s-gmode'); if (m && m.value === 'off') m.value = 'flag';
    }, function (err) { if (note) note.textContent = err.code === 1 ? 'Location is blocked for this site — allow it in your browser settings.' : 'Couldn’t get your location. Try again near a window.'; }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };

  // ---------- WhatsApp reports (King PRO, opt-in) ----------
  var WA = { loaded: false, busy: false, data: null, preview: '', err: '' };
  function waLoad() {
    if (WA.busy) return; WA.busy = true;
    St.backend().whatsapp({ op: 'get' }).then(function (d) { WA.data = d; WA.loaded = true; WA.busy = false; U.render(); }, function (e) { WA.err = e.userMessage || 'Couldn’t load'; WA.loaded = true; WA.busy = false; U.render(); });
  }
  function waCard() {
    var head = '<section class="card"><div class="card-h"><h2>' + ic('whatsapp') + 'WhatsApp attendance reports</h2>' + (St.can('whatsapp') ? '' : U.lockNote('whatsapp', 'King PRO')) + '</div>';
    if (!St.can('whatsapp')) return head + '<p class="muted">A daily or weekly attendance summary on your WhatsApp. Available on King PRO.</p></section>';
    var w;
    if (St.live) {
      if (!WA.loaded) { waLoad(); return head + '<div class="empty">Loading…</div></section>'; }
      if (WA.err) return head + '<div class="empty">' + esc(WA.err) + '</div></section>';
      var sd = WA.data.settings || {};
      w = { enabled: !!sd.enabled, recipient: String(sd.recipient || '').replace(/^\+91/, ''), cadence: sd.cadence || 'daily', sendTime: sd.sendTime || '20:00', weekday: sd.weekday != null ? sd.weekday : 1, providerConfigured: WA.data.providerConfigured, log: WA.data.log || [] };
    } else w = St.settings().whatsapp;
    return head + '<form data-set="wa" novalidate>' +
      (w.enabled ? '<p class="ok-note" style="margin-bottom:10px">' + ic('check') + 'On — ' + (w.cadence === 'weekly' ? 'every ' + U.DOW_LONG[w.weekday] : 'every day') + ' at ' + U.hm12(w.sendTime) + ' to +91 ' + U.mobile(w.recipient) + '</p>' : '') +
      (w.providerConfigured ? '' : '<p class="warn">' + ic('alert') + '<span>WhatsApp sending isn’t connected yet. You can save your choice now; reports start once it’s connected.</span></p>') +
      '<div class="grid2">' + U.field('Send to (WhatsApp number)', '<div class="phone-in"><span>+91</span><input id="s-war" name="recipient" inputmode="numeric" maxlength="10" value="' + esc(w.recipient) + '"></div>', { for: 'recipient' }) +
      U.field('How often', '<select id="s-wac" name="cadence">' + U.options([['daily', 'Every day'], ['weekly', 'Once a week']], w.cadence) + '</select>', { for: 'cadence' }) +
      U.field('Time', '<input id="s-wat" name="sendTime" type="time" value="' + esc(w.sendTime) + '">', { for: 'sendTime' }) +
      U.field('Day (weekly)', '<select id="s-waw" name="weekday">' + U.options(U.DOW_LONG.map(function (d, i) { return [i, d]; }), w.weekday) + '</select>', { for: 'weekday' }) + '</div>' +
      '<label class="consent"><input type="checkbox" name="consent"' + (w.enabled ? ' checked' : '') + '> I agree to receive attendance reports for this business on WhatsApp at this number. I can turn this off any time.</label><small class="err" data-err="consent"></small>' +
      '<div class="form-f" style="gap:8px;flex-wrap:wrap">' + (w.enabled ? '<button type="button" class="btn danger-o" data-a="wa-off">Turn off</button>' : '') + '<button type="button" class="btn" data-a="wa-preview">Preview today’s report</button><button class="btn pri" type="submit">' + (w.enabled ? 'Save changes' : 'Turn on reports') + '</button></div>' +
      (WA.preview ? '<pre class="wa-prev">' + esc(WA.preview) + '</pre>' : '') +
      (w.log && w.log.length ? '<h3 class="sub-h">Recent sends</h3><ul class="list">' + w.log.slice(0, 5).map(function (l) { return '<li><span class="grow"><b>' + esc(l.key || '') + '</b><small>' + (l.ok ? 'Sent' : 'Failed: ' + esc(l.error || '')) + '</small></span></li>'; }).join('') + '</ul>' : '') +
      '</form></section>';
  }
  function waPreviewText() {
    var rows = St.day(St.today), c = { P: 0, H: 0, A: 0, L: 0, N: 0 }, late = [], abs = [];
    rows.forEach(function (x) { var s = x.rec ? x.rec.status : 'notin'; if (s === 'present' || s === 'late') c.P++; else if (s === 'halfday') c.H++; else if (s === 'absent') { c.A++; abs.push(x.person.name); } else if (s === 'leave') c.L++; else if (s !== 'weeklyoff') c.N++; if (s === 'late') late.push(x.person.name); });
    return ['Staff360 · ' + St.business.name + ' · ' + St.today, 'Present ' + c.P + ' · Half-day ' + c.H + ' · Absent ' + c.A + ' · Leave ' + c.L + ' · Not marked ' + c.N, abs.length ? 'Absent: ' + abs.join(', ') : '', late.length ? 'Late: ' + late.join(', ') : ''].filter(Boolean).join('\n');
  }
  U.actions['wa-preview'] = function () {
    if (!St.live) { WA.preview = waPreviewText(); U.render(); return; }
    St.backend().whatsapp({ op: 'preview' }).then(function (r) { WA.preview = r.text; U.render(); }, function (e) { U.toast(e.userMessage || 'Couldn’t make the preview'); });
  };
  U.actions['wa-off'] = function () {
    if (!St.live) { var w = St.settings().whatsapp; w.enabled = false; St.saveSettings('whatsapp', w); U.toast('WhatsApp reports turned off'); return; }
    St.backend().whatsapp({ op: 'disable' }).then(function () { WA.loaded = false; U.render(); U.toast('WhatsApp reports turned off'); }, function (e) { U.toast(e.userMessage || 'Couldn’t turn off'); });
  };
  function waSubmit(f) {
    var num = U.val(f, 'recipient').replace(/\D/g, ''), ok = true;
    ok = U.setErr(f, 'recipient', /^[6-9]\d{9}$/.test(num) ? '' : 'Enter a 10-digit WhatsApp number') && ok;
    ok = U.setErr(f, 'sendTime', U.val(f, 'sendTime') ? '' : 'Pick a time') && ok;
    ok = U.setErr(f, 'consent', U.val(f, 'consent') ? '' : 'Tick the box to agree to receive reports') && ok;
    if (!ok) return;
    var v = { recipient: num, cadence: U.val(f, 'cadence'), sendTime: U.val(f, 'sendTime'), weekday: +U.val(f, 'weekday') };
    if (!St.live) { var w = St.settings().whatsapp; Object.assign(w, v, { enabled: true }); St.saveSettings('whatsapp', w); U.toast('Saved. In this preview nothing is sent.'); return; }
    var b = f.querySelector('button[type=submit]'); b.disabled = true;
    St.backend().whatsapp({ op: 'save', recipient: '+91' + v.recipient, cadence: v.cadence, sendTime: v.sendTime, weekday: v.weekday, consent: true }).then(function (r) {
      U.clean(f); WA.loaded = false; U.render(); U.toast(r.note || 'WhatsApp reports turned on');
    }, function (e) { b.disabled = false; U.toast(e.userMessage || 'Couldn’t save'); });
  }

  document.addEventListener('submit', function (e) {
    var f = e.target, part = f.getAttribute && f.getAttribute('data-set'); if (!part) return;
    e.preventDefault();
    if (part === 'wa') { waSubmit(f); return; }
    if (part === 'fence') {
      var lat = U.val(f, 'lat'), lng = U.val(f, 'lng'), mode = U.val(f, 'mode'), rad = +U.val(f, 'radiusM'), okF = true;
      var badLat = lat !== '' && !(Math.abs(+lat) <= 90), badLng = lng !== '' && !(Math.abs(+lng) <= 180);
      okF = U.setErr(f, 'lat', badLat ? 'Latitude is between -90 and 90' : mode !== 'off' && lat === '' ? 'Set the shop location first' : '') && okF;
      okF = U.setErr(f, 'lng', badLng ? 'Longitude is between -180 and 180' : mode !== 'off' && lng === '' ? 'Set the shop location first' : '') && okF;
      okF = U.setErr(f, 'radiusM', rad >= 50 && rad <= 5000 ? '' : 'Between 50 and 5000 metres') && okF;
      if (!okF) return;
      U.clean(f); St.saveSettings('fence', { lat: lat === '' ? null : +lat, lng: lng === '' ? null : +lng, radiusM: rad, mode: mode }); U.toast('Shop location saved');
      return;
    }
    var s = St.settings(), v = JSON.parse(JSON.stringify(part === 'rules' ? s.rules : s[part]));
    if (part === 'business' && St.live) {
      v = Object.assign({}, s.business, { name: U.val(f, 'name') });
      if (!U.setErr(f, 'name', v.name.length < 2 ? 'Enter the business name' : '')) return;
    } else if (part === 'business') {
      v = { name: U.val(f, 'name'), city: U.val(f, 'city'), owner: U.val(f, 'owner'), phone: U.val(f, 'phone').replace(/\D/g, '') };
      var ok = U.setErr(f, 'name', v.name.length < 2 ? 'Enter the business name' : '');
      ok = U.setErr(f, 'owner', v.owner.length < 2 ? 'Enter the owner’s name' : '') && ok;
      ok = U.setErr(f, 'phone', v.phone && !/^[6-9]\d{9}$/.test(v.phone) ? 'Enter a 10-digit mobile number' : '') && ok;
      if (!ok) return;
    } else {
      [].forEach.call(f.querySelectorAll('input,select'), function (i) {
        if (!i.name || i.name === 'defaultWeeklyOff') return;
        v[i.name] = i.type === 'checkbox' ? i.checked : +i.value;
      });
      if (part === 'rules') {
        if (!(v.hoursPerDay >= 1 && v.hoursPerDay <= 16)) { U.setErr(f, 'hoursPerDay', 'Between 1 and 16 hours'); return; }
        var wo = f.querySelector('[name=defaultWeeklyOff]'); if (wo) St.saveSettings('defaultWeeklyOff', +wo.value);
      }
    }
    U.clean(f); St.saveSettings(part, v); U.toast('Settings saved');
  });
  U.actions['demo-reset'] = function () { U.confirm('Reset demo data?', 'All changes you made in this preview will be undone.', 'Reset', function () { U.state.chat = []; St.reset(); U.toast('Demo data reset'); }, true); };

  // ---------- plans ----------
  var PLAN_FEATURES = {
    basic: ['Add and manage staff', 'Owner/manager marks attendance', 'Present, absent, half-day, leave, weekly off', 'Daily attendance register', 'Attendance history and basic reports'],
    premium: ['Everything in Basic', 'Staff check-in / check-out from their phone', 'Location at check-in (no background tracking)', 'Shifts, weekly offs and late marks', 'Leave requests and approvals', 'Working hours, overtime and advanced reports'],
    kingpro: ['Everything in Premium', 'AI attendance assistant', 'Repeated late-arrival and pattern alerts', 'Workforce availability insights', 'Draft salary estimates you approve', 'WhatsApp attendance reports (opt-in)'],
  };
  U.views.plans = function () {
    var h = U.pageHead('Subscription', 'Choose the plan that fits your team. You can change plans any time; your data stays.');
    h += '<div class="plan-grid">' + ['basic', 'premium', 'kingpro'].map(function (p) {
      var cur = St.plan === p, price = p === 'kingpro' ? '<b>₹4,999</b><small>/ year per business</small>' : '<b class="ask-p">Contact for pricing</b><small>Priced for your business</small>';
      return '<section class="card plan-c ' + p + (cur ? ' cur' : '') + '">' + (p === 'kingpro' ? '<span class="ribbon">Most powerful</span>' : '') +
        '<h2>' + (p === 'kingpro' ? ic('crown') : '') + St.PLAN_LABEL[p] + (cur ? ' <span class="badge b-green">' + (St.live ? 'Your plan' : 'Current (demo)') + '</span>' : '') + '</h2><div class="price">' + price + '</div>' +
        '<ul>' + PLAN_FEATURES[p].map(function (f) { return '<li>' + ic('check') + f + '</li>'; }).join('') + '</ul>' +
        '<div class="plan-act">' + (cur ? '<button class="btn" disabled>Your plan</button>' : '<a class="btn pri" href="' + WA + encodeURIComponent('Hi, I want Staff360 ' + St.PLAN_LABEL[p] + ' for my business') + '" target="_blank" rel="noopener">Talk to us on WhatsApp</a>') +
        (cur || St.live ? '' : '<button class="btn ghost" data-a="plan:' + p + '">Preview ' + St.PLAN_LABEL[p] + ' in demo</button>') + '</div></section>';
    }).join('') + '</div><p class="muted small" style="margin-top:12px">' + (St.live ? 'Message us on WhatsApp to upgrade and we’ll switch your plan on. Your staff and attendance stay as they are. Taxes as applicable.' : 'Payments aren’t taken in this preview. Taxes as applicable.') + '</p>';
    return h;
  };

  // ---------- help ----------
  var FAQ = [
    ['How do staff check in?', 'On Premium and King PRO, staff log in at hisaabnow.com/staff360/login with their mobile number and an OTP, then tap Check in. Location is captured only at that moment.'],
    ['Can I correct a mistake in attendance?', 'Yes. Open Attendance, click the pencil on the row, pick the right status and give a reason. The old value is kept in the activity log.'],
    ['Does Staff360 use selfies or fingerprints?', 'No. Staff360 never asks for selfies, face scans or fingerprints.'],
    ['Does Staff360 pay salaries?', 'No. King PRO prepares a salary estimate that you review and approve. You pay staff yourself.'],
    ['Can employees see other staff or my sales?', 'No. Employees see only their own attendance, shift and leave.'],
  ];
  U.views.help = function () {
    return U.pageHead('Help & Support', 'Quick answers, guides and a real person on WhatsApp.') +
      '<div class="row r-3"><a class="card help-c" href="' + WA + encodeURIComponent('Hi, I need help with Staff360') + '" target="_blank" rel="noopener"><span class="ii" style="background:var(--success-light);color:var(--success)">' + ic('whatsapp') + '</span><b>Chat on WhatsApp</b><small>+91 78383 61200 · Mon–Sat, 10 am – 7 pm</small></a>' +
      '<a class="card help-c" href="https://hisaabnow.com/staff360/" target="_blank" rel="noopener"><span class="ii" style="background:var(--blue-light);color:var(--blue)">' + ic('report') + '</span><b>Product guide</b><small>Plans, features and FAQs</small></a>' +
      '<a class="card help-c" href="https://hisaabnow.com/tools/attendance-sheet-format" target="_blank" rel="noopener"><span class="ii" style="background:var(--orange-light);color:var(--orange)">' + ic('download') + '</span><b>Attendance sheet (Excel)</b><small>Free template for your records</small></a></div>' +
      '<section class="card"><div class="card-h"><h2>Frequently asked questions</h2></div><div class="faq">' + FAQ.map(function (f) { return '<details><summary>' + f[0] + '</summary><p>' + f[1] + '</p></details>'; }).join('') + '</div></section>';
  };
})();
