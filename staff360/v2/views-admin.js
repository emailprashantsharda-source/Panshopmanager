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
      (St.live ? '<div class="set-row"><div><b>Location at check-in</b><small>Captured only at the moment of check-in and check-out — never in the background.</small></div><span class="badge b-green">On</span></div>' :
      toggle('gpsRequired', 'Capture location at check-in', r.gpsRequired, 'Only at the moment of check-in and check-out — never in the background', 'gps')) +
      toggle('allowNoGps', 'Allow check-in when location is off', r.allowNoGps, 'Saved as “No GPS” so you can see it', 'gps') +
      fs1 + saveBtn('Save rules') + '</form>';

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

    h += '<section class="card"><div class="card-h"><h2>' + ic('star') + 'Subscription &amp; billing</h2></div><div class="set-row"><div><b>Current plan: ' + St.PLAN_LABEL[St.plan] + '</b><small>Plans are per business. King PRO is ₹4,999/year.</small></div><a class="btn" href="#/plans">Manage plan</a></div>' +
      (St.live ? '' : '<div class="set-row"><div><b>Reset demo data</b><small>Puts the sample team and attendance back the way they started.</small></div><button class="btn danger-o" data-a="demo-reset">Reset</button></div>') + '</section>';
    return h + '</div>';
  };
  document.addEventListener('submit', function (e) {
    var f = e.target, part = f.getAttribute && f.getAttribute('data-set'); if (!part) return;
    e.preventDefault();
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
    St.saveSettings(part, v); U.toast('Settings saved');
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
