/* Staff360 v2 — King PRO AI Staff Manager (simulated), insights, anomalies and salary estimator.
 * No AI service is called. Every answer is computed from the attendance records shown in the app.
 */
(function () {
  'use strict';
  var St = window.S360Store, U = window.S360UI, esc = U.esc, ic = U.ic;
  var F = U.state;
  F.chat = F.chat || [];
  var QUESTIONS = [
    'Who was absent most frequently this month?',
    'Which employees are regularly arriving late?',
    'How many employees are available tomorrow?',
    'Show this month’s attendance summary.',
    'Estimate salary based on attendance.',
    'Which employees have pending leave requests?',
  ];

  function monthRecs() { return St.range(U.monthStart(St.today), St.today).filter(function (r) { var p = St.person(r.staff); return p && p.status === 'Active'; }); }
  function byStaff(recs, status) {
    var m = {}; recs.forEach(function (r) { if (r.status === status) (m[r.staff] = m[r.staff] || []).push(r.date); });
    return Object.keys(m).map(function (k) { return { p: St.person(k), dates: m[k].sort() }; }).sort(function (a, b) { return b.dates.length - a.dates.length; });
  }
  function dates(ds) { return ds.map(function (d) { return U.dLabel(d); }).join(', '); }
  function tomorrow() {
    var t = U.addDays(St.today, 1), dow = U.parse(t).getDay(), off = [], leave = [];
    var avail = St.staff().filter(function (p) {
      if (p.weeklyOff === dow) { off.push(p); return false; }
      if (St.leaves().some(function (l) { return l.staff === p.id && l.status === 'Approved' && t >= l.from && t <= l.to; })) { leave.push(p); return false; }
      return true;
    });
    var pend = St.leaves().filter(function (l) { return l.status === 'Pending' && t >= l.from && t <= l.to; });
    return { date: t, avail: avail, off: off, leave: leave, pend: pend };
  }
  function names(ps) { return ps.map(function (p) { return esc(p.name); }).join(', '); }
  function overtimeMin(r) {
    var p = St.person(r.staff), sh = p && St.shift(p.shift), w = U.worked(r);
    if (!sh || w == null || r.status === 'halfday') return 0;
    var len = U.toMin(sh.end) - U.toMin(sh.start); if (len <= 0) len += 1440;
    var extra = w - (len - sh.breakMin);
    return extra >= 15 ? extra : 0;
  }

  // ---------- simulated answers ----------
  function answer(q) {
    var s = q.toLowerCase(), recs = monthRecs(), mon = U.monthLabel(St.today.slice(0, 7));
    if (/absent/.test(s)) {
      var a = byStaff(recs, 'absent');
      if (!a.length) return 'No one has been absent in ' + mon + ' so far.';
      return 'Most absences in ' + mon + ':<ul>' + a.slice(0, 3).map(function (x) { return '<li><b>' + esc(x.p.name) + '</b> — ' + x.dates.length + ' day' + (x.dates.length > 1 ? 's' : '') + ' (' + dates(x.dates) + ')</li>'; }).join('') + '</ul>Based on ' + recs.length + ' attendance records.';
    }
    if (/late/.test(s)) {
      var l = byStaff(recs, 'late').filter(function (x) { return x.dates.length >= 3; });
      if (!l.length) return 'No one has been late 3 or more times in ' + mon + '.';
      return l.length + ' employee' + (l.length > 1 ? 's have' : ' has') + ' been late 3 or more times this month:<ul>' + l.map(function (x) {
        var mins = x.dates.map(function (d) { return U.lateMin(St.record(x.p.id, d)); });
        return '<li><b>' + esc(x.p.name) + '</b> — ' + x.dates.length + ' late arrivals, average ' + Math.round(U.avg(mins)) + ' min (' + dates(x.dates) + ')</li>';
      }).join('') + '</ul>Would you like to talk to them, or adjust their shift?';
    }
    if (/tomorrow|available|availability/.test(s)) {
      var t = tomorrow();
      return '<b>' + t.avail.length + ' of ' + St.staff().length + '</b> employees are available on ' + U.dLabel(t.date, true) + '.<ul>' +
        (t.off.length ? '<li>Weekly off: ' + names(t.off) + '</li>' : '') + (t.leave.length ? '<li>On approved leave: ' + names(t.leave) + '</li>' : '') +
        (t.pend.length ? '<li>Pending leave that would also be off: ' + names(t.pend.map(function (l) { return St.person(l.staff); })) + '</li>' : '') + '</ul>';
    }
    if (/summary|this month|overview/.test(s)) {
      var c = U.count(recs), hrs = U.avg(recs.filter(function (r) { return r.date < St.today; }).map(U.worked));
      return '<b>' + mon + '</b> so far (' + U.parse(St.today).getDate() + ' days, ' + St.staff().length + ' active staff):<ul><li>Attendance rate <b>' + Math.round((c.rate || 0) * 1000) / 10 + '%</b></li><li>' + c.present + ' on time · ' + c.late + ' late · ' + c.halfday + ' half days</li><li>' + c.absent + ' absences · ' + c.leave + ' leave days · ' + c.weeklyoff + ' weekly offs</li><li>Average ' + U.dur(hrs) + ' worked per present day</li></ul>';
    }
    if (/salary|pay|wage/.test(s)) {
      var rows = St.staff().filter(function (p) { return p.salary; }).slice(0, 5).map(function (p) { var e = estimateFor(p.id, lastMonth()); return '<li><b>' + esc(p.name) + '</b> — ' + U.inr(e.total) + ' (' + e.payable + ' payable days)</li>'; });
      return 'Estimated salaries for <b>' + U.monthLabel(lastMonth()) + '</b> (first 5 staff):<ul>' + rows.join('') + '</ul><span class="est">Estimated — requires owner approval.</span> Open the salary estimator to see the full calculation.';
    }
    if (/leave|pending|request/.test(s)) {
      var pend = St.leaves().filter(function (x) { return x.status === 'Pending'; });
      if (!pend.length) return 'There are no pending leave requests.';
      return pend.length + ' pending leave request' + (pend.length > 1 ? 's' : '') + ':<ul>' + pend.map(function (x) { return '<li><b>' + esc(St.person(x.staff).name) + '</b> — ' + x.type + ', ' + U.dLabel(x.from) + (x.to !== x.from ? ' – ' + U.dLabel(x.to) : '') + ' (' + x.days + ' day' + (x.days > 1 ? 's' : '') + '): “' + esc(x.reason) + '”</li>'; }).join('') + '</ul><a href="#/leave">Review them in Leave Management →</a>';
    }
    return 'In this preview I can answer questions about absences, late arrivals, tomorrow’s availability, this month’s summary, salary estimates and pending leave. Try one of the suggested questions.';
  }

  // ---------- salary estimate ----------
  function lastMonth() { var d = U.parse(U.monthStart(St.today)); d.setDate(0); return U.iso(d).slice(0, 7); }
  function estimateFor(sid, ym, override) {
    var p = St.person(sid), y = +ym.slice(0, 4), m = +ym.slice(5, 7), dim = new Date(y, m, 0).getDate();
    var to = ym === St.today.slice(0, 7) ? St.today : ym + '-' + U.pad(dim);
    var recs = St.range(ym + '-01', to).filter(function (r) { return r.staff === sid; }), c = U.count(recs);
    var paidLeave = 0, unpaid = 0;
    recs.filter(function (r) { return r.status === 'leave'; }).forEach(function (r) {
      var l = St.leaves().filter(function (x) { return x.staff === sid && x.status === 'Approved' && r.date >= x.from && r.date <= x.to; })[0];
      if (l && l.type === 'Unpaid') unpaid++; else paidLeave++;
    });
    var v = override || {
      salary: p.salary || 0, dim: dim, present: c.present + c.late + c.halfday * 0.5, absent: c.absent, paidLeave: paidLeave, unpaid: unpaid, offs: c.weeklyoff,
      ot: Math.round(recs.reduce(function (s, r) { return s + overtimeMin(r); }, 0) / 30) / 2,
    };
    var perDay = v.dim ? v.salary / v.dim : 0, payable = v.present + v.paidLeave + v.offs;
    var base = perDay * payable, otPay = perDay / (St.settings().rules.hoursPerDay || 8) * v.ot * 2, deducted = perDay * (v.absent + v.unpaid);
    return { v: v, perDay: perDay, payable: payable, base: base, otPay: otPay, deducted: deducted, total: Math.round(base + otPay), partial: to !== ym + '-' + U.pad(dim) };
  }

  F.sal = F.sal || null;
  U.views.ai = function () {
    if (!St.can('ai')) return U.locked('ai', 'AI Staff Manager', 'Ask questions about your team in simple English, get alerts for repeated late arrivals and unusual patterns, and draft salary estimates you approve.');
    var h = '<div class="page-h"><div><h1>' + ic('crown', 'crown') + 'AI Staff Manager <span class="badge b-purple">King PRO</span></h1><p>Your assistant for attendance, workforce insights and salary estimates.</p></div>' +
      '<div class="ph-act"><span class="sample">' + ic('alert') + (St.live ? (St.extra.ai && St.extra.ai.configured ? 'Answers are based on your attendance records' : 'Answers are worked out from your attendance records (AI writing is not switched on yet)') : 'Simulated — answers are computed from your attendance records; no AI service is connected in this preview') + '</span></div></div>';

    // insights
    var recs = monthRecs(), c = U.count(recs);
    var lm = lastMonth(), lrecs = St.range(lm + '-01', lm + '-' + U.pad(U.parse(St.today).getDate())).filter(function (r) { var p = St.person(r.staff); return p && p.status === 'Active'; }), lc = U.count(lrecs);
    var delta = c.rate != null && lc.rate != null ? Math.round((c.rate - lc.rate) * 1000) / 10 : null;
    var lates = byStaff(recs, 'late').filter(function (x) { return x.dates.length >= 3; });
    var pend = St.leaves().filter(function (l) { return l.status === 'Pending'; }), tm = tomorrow();
    var noOut = St.range(U.addDays(St.today, -7), U.addDays(St.today, -1)).filter(function (r) { return U.isIn(r) && !r.out; });
    var wkAbs = {}; recs.filter(function (r) { return r.status === 'absent'; }).forEach(function (r) { var k = r.staff + ':' + U.parse(r.date).getDay(); (wkAbs[k] = wkAbs[k] || []).push(r.date); });
    var anomalies = [];
    lates.forEach(function (x) { anomalies.push(['b-amber', 'Repeated late arrivals', esc(x.p.name) + ' was late ' + x.dates.length + ' times (' + dates(x.dates) + ')', x.p.id]); });
    Object.keys(wkAbs).forEach(function (k) { if (wkAbs[k].length >= 2) { var p = St.person(k.split(':')[0]); anomalies.push(['b-red', 'Absent on the same weekday', esc(p.name) + ' was absent on ' + U.DOW_LONG[+k.split(':')[1]] + 's: ' + dates(wkAbs[k]), p.id]); } });
    St.range(U.monthStart(St.today), St.today).filter(function (r) { return r.gps && r.gps.outside; }).forEach(function (r) {
      var p = St.person(r.staff); if (p) anomalies.push(['b-red', 'Checked in away from the shop', esc(p.name) + ' on ' + U.dLabel(r.date) + ' — ' + r.gps.dist + ' m away', p.id]);
    });
    noOut.forEach(function (r) { var p = St.person(r.staff); anomalies.push(['b-blue', 'Missing check-out', esc(p.name) + ' checked in on ' + U.dLabel(r.date) + ' but has no check-out', p.id]); });

    h += '<div class="row ai-grid"><section class="card ai-q"><div class="card-h"><h2>Ask anything about your team</h2></div>' +
      QUESTIONS.map(function (q, i) { return '<button class="q" data-a="ai-ask:' + i + '">' + ic('spark') + '<span>' + esc(q) + '</span></button>'; }).join('') + '</section>';

    h += '<section class="card ai-chat"><div class="msgs" id="ai-msgs" aria-live="polite">' + (F.chat.length ? F.chat.map(function (m) {
      return '<div class="msg ' + m.who + '">' + (m.who === 'ai' ? '<span class="bot">' + ic('crown') + '</span>' : '') + '<div class="bubble">' + m.html + '<small>' + m.at + '</small></div></div>';
    }).join('') : '<div class="chat-empty">' + ic('crown') + '<b>Ask a question to get started</b><span>Pick a suggestion, or type your own.</span></div>') + (F.typing ? '<div class="msg ai"><span class="bot">' + ic('crown') + '</span><div class="bubble typing"><i></i><i></i><i></i></div></div>' : '') + '</div>' +
      '<div class="ask"><label class="sr" for="ai-in">Ask a question</label><input id="ai-in" placeholder="Ask a question about your team…" maxlength="200" autocomplete="off"><button class="btn pri" data-a="ai-send" aria-label="Send">' + ic('send') + '</button></div></section>';

    h += '<section class="card ai-ins"><div class="card-h"><h2>' + ic('spark') + 'AI Insights</h2></div><ul class="ins">' +
      '<li><span class="ii" style="background:var(--success-light);color:var(--success)">' + ic('trend') + '</span><span>' + (delta == null ? 'Not enough data to compare with last month yet.' : 'Attendance is <b>' + Math.round(c.rate * 100) + '%</b> this month, ' + (delta >= 0 ? 'up ' : 'down ') + Math.abs(delta) + ' points on the same days last month.') + '</span></li>' +
      '<li><span class="ii" style="background:var(--warning-light);color:#B7791F">' + ic('clock') + '</span><span><b>' + lates.length + ' employee' + (lates.length === 1 ? ' was' : 's were') + '</b> late 3 or more times this month.' + (lates.length ? ' ' + names(lates.map(function (x) { return x.p; })) + '.' : '') + '</span></li>' +
      '<li><span class="ii" style="background:var(--purple-light);color:var(--purple)">' + ic('leave') + '</span><span><b>' + pend.length + '</b> leave request' + (pend.length === 1 ? ' is' : 's are') + ' waiting for you. <a href="#/leave">Review</a></span></li>' +
      '<li><span class="ii" style="background:var(--blue-light);color:var(--blue)">' + ic('users') + '</span><span>Tomorrow’s availability: <b>' + tm.avail.length + ' of ' + St.staff().length + '</b> staff.</span></li></ul>' +
      '<h3 class="sub-h">' + ic('alert') + 'Patterns to review (' + anomalies.length + ')</h3>' + (anomalies.length ? '<ul class="list anomalies">' + anomalies.slice(0, 5).map(function (a) { return '<li><span class="grow"><span class="badge ' + a[0] + '">' + a[1] + '</span><small style="display:block;margin-top:3px">' + a[2] + '</small></span><a class="btn sm" href="#/staff/' + a[3] + '">View</a></li>'; }).join('') + '</ul>' : '<p class="muted">Nothing unusual this month.</p>') +
      '<p class="muted small">Patterns are flags to check, not conclusions. Always look at the dates first.</p></section></div>';

    h += St.live ? salaryLive() : salaryCard();
    return h;
  };

  function salaryCard() {
    var staff = St.staff().filter(function (p) { return p.salary; });
    if (!F.sal || !St.person(F.sal.sid)) F.sal = { sid: (staff[0] || {}).id, ym: lastMonth(), v: null };
    var e = estimateFor(F.sal.sid, F.sal.ym, F.sal.v), v = e.v, p = St.person(F.sal.sid);
    var approved = St.approvals().filter(function (a) { return a.staff === F.sal.sid && a.month === F.sal.ym; })[0];
    function num(name, label, val, step, hint) { return U.field(label, '<input id="sal-' + name + '" type="number" min="0" step="' + (step || 1) + '" data-sal="' + name + '" value="' + val + '">', { for: 'sal-' + name, hint: hint }); }
    return '<section class="card sal"><div class="card-h"><h2>' + ic('rupee') + 'Salary Estimator</h2><span class="badge b-amber">Estimated — requires owner approval</span></div>' +
      '<div class="sal-grid"><div class="sal-in"><div class="grid2">' +
      U.field('Employee', '<select id="sal-sid" data-sal="sid">' + U.options(staff.map(function (s) { return [s.id, s.name]; }), F.sal.sid) + '</select>', { for: 'sal-sid' }) +
      U.field('Month', '<select id="sal-ym" data-sal="ym">' + U.options([[lastMonth(), U.monthLabel(lastMonth()) + ' (complete)'], [St.today.slice(0, 7), U.monthLabel(St.today.slice(0, 7)) + ' (to date)']], F.sal.ym) + '</select>', { for: 'sal-ym' }) +
      num('salary', 'Monthly salary (₹)', v.salary, 100) + num('dim', 'Days in month', v.dim, 1, 'Salary ÷ this = per-day rate') +
      num('present', 'Attendance days', v.present, 0.5, 'Half days count as 0.5') + num('absent', 'Absent days', v.absent, 1) +
      num('paidLeave', 'Paid leave days', v.paidLeave, 1) + num('unpaid', 'Unpaid leave days', v.unpaid, 1) +
      num('offs', 'Paid weekly offs', v.offs, 1) + num('ot', 'Overtime (hours)', v.ot, 0.5, 'Paid at 2× the hourly rate') +
      '</div><button class="btn sm" data-a="sal-reset">' + ic('refresh') + 'Reset to attendance records</button></div>' +
      '<div class="sal-out"><small>Estimated payable salary · ' + esc(p ? p.name : '') + '</small><b class="big">' + U.inr(e.total) + '</b>' +
      (e.partial ? '<p class="muted small">Month to date — not the full month yet.</p>' : '') +
      '<dl class="calc"><dt>Per-day rate</dt><dd>' + U.inr2(v.salary) + ' ÷ ' + v.dim + ' = ' + U.inr2(e.perDay) + '</dd>' +
      '<dt>Payable days</dt><dd>' + v.present + ' worked + ' + v.paidLeave + ' paid leave + ' + v.offs + ' weekly offs = <b>' + e.payable + '</b></dd>' +
      '<dt>Base pay</dt><dd>' + U.inr2(e.perDay) + ' × ' + e.payable + ' = ' + U.inr(e.base) + '</dd>' +
      '<dt>Overtime</dt><dd>' + v.ot + ' h × ' + U.inr2(e.perDay / (St.settings().rules.hoursPerDay || 8)) + '/h × 2 = +' + U.inr(e.otPay) + '</dd>' +
      '<dt>Not paid</dt><dd>' + (v.absent + v.unpaid) + ' day(s) absent or unpaid leave (−' + U.inr(e.deducted) + ' vs full month)</dd>' +
      '<dt class="tot">Estimate</dt><dd class="tot">' + U.inr(e.total) + '</dd></dl>' +
      '<div class="warn">' + ic('alert') + '<span><b>Estimated — owner approval required.</b> Staff360 never pays salaries. Check advances, deductions and statutory rules before you pay.</span></div>' +
      (approved ? '<p class="ok-note">' + ic('check') + 'You approved ' + U.inr(approved.amount) + ' on ' + esc(approved.at) + '. No payment was made.</p>' : '<button class="btn pri" data-a="sal-approve" style="width:100%">' + ic('check') + 'Approve this estimate</button>') +
      '</div></div></section>';
  }

  // ---------- actions ----------
  function now() { var d = new Date(); return U.t12(d.getHours() * 60 + d.getMinutes()); }
  function ask(q) {
    q = String(q || '').trim(); if (!q) return;
    F.chat.push({ who: 'me', html: esc(q), at: now() }); F.typing = true; U.render(); scroll();
    var done = function (html) { F.typing = false; F.chat.push({ who: 'ai', html: html, at: now() }); U.render(); scroll(); var i = document.getElementById('ai-in'); if (i) i.focus(); };
    if (!St.live) { setTimeout(function () { done(answer(q)); }, 550); return; }
    St.backend().aiAsk(q).then(function (r) {
      var items = [].concat.apply([], (r.results || []).map(function (x) { return x.items || []; })).slice(0, 12);
      var period = r.period && r.period.label ? '<small class="muted" style="display:block">' + esc(r.period.label) + (r.period.from ? ' · ' + esc(r.period.from) + ' to ' + esc(r.period.to) : '') + '</small>' : '';
      done(esc(r.text || 'No answer.').replace(/\n/g, '<br>') + (items.length ? '<ul>' + items.map(function (i) { return '<li><b>' + esc(i.name || '') + '</b>' + (i.value ? ' — ' + esc(i.value) : '') + '</li>'; }).join('') + '</ul>' : '') + period);
    }, function (e) { done('<span class="muted">' + esc(e.userMessage || 'Couldn’t get an answer. Try again.') + '</span>'); });
  }
  function scroll() { var m = document.getElementById('ai-msgs'); if (m) m.scrollTop = m.scrollHeight; }
  U.actions['ai-ask'] = function (p) { ask(QUESTIONS[+p[0]]); };
  U.actions['ai-send'] = function () { var i = document.getElementById('ai-in'); if (i) ask(i.value); };
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'ai-in') { e.preventDefault(); ask(e.target.value); } });
  // Salary inputs: update without re-rendering the whole page on every keystroke
  document.addEventListener('change', function (e) {
    var k = e.target.getAttribute && e.target.getAttribute('data-sal'); if (!k) return;
    if (k === 'sid' || k === 'ym') { F.sal[k] = e.target.value; F.sal.v = null; U.render(); return; }
    var cur = estimateFor(F.sal.sid, F.sal.ym, F.sal.v).v, v = {}; Object.keys(cur).forEach(function (x) { v[x] = cur[x]; });
    var n = parseFloat(e.target.value); v[k] = isFinite(n) && n >= 0 ? n : 0; if (k === 'dim' && !v.dim) v.dim = 30;
    F.sal.v = v; U.render();
  });
  U.actions['sal-reset'] = function () { F.sal.v = null; U.render(); };
  U.actions['sal-approve'] = function () {
    var e = estimateFor(F.sal.sid, F.sal.ym, F.sal.v), p = St.person(F.sal.sid);
    U.confirm('Approve ' + U.inr(e.total) + ' for ' + esc(p.name) + '?', 'This records your approval of the estimate for ' + U.monthLabel(F.sal.ym) + '. <b>No money is paid</b> — you pay salaries yourself as usual.', 'Approve estimate', function () {
      St.approveSalary(p.id, F.sal.ym, e.total, { perDay: e.perDay, payable: e.payable, ot: e.v.ot }); U.toast('Estimate approved for ' + p.name + '. No payment was made.');
    });
  };
  U.salaryEstimate = estimateFor;

  // ---------- live salary estimates (server-computed, owner approves) ----------
  F.sl = F.sl || { ym: null, data: {}, sid: null, busy: false, err: '' };
  function loadSalary(ym) {
    if (F.sl.busy) return; F.sl.busy = true; F.sl.err = '';
    St.backend().salaryList(ym).then(function (d) { F.sl.data[ym] = d; F.sl.busy = false; U.render(); }, function (e) { F.sl.busy = false; F.sl.err = e.userMessage || 'Couldn’t load salary estimates'; U.render(); });
  }
  function salaryLive() {
    if (!F.sl.ym) F.sl.ym = St.today.slice(0, 7);
    var d = F.sl.data[F.sl.ym], head = '<section class="card sal"><div class="card-h"><h2>' + ic('rupee') + 'Salary Estimator</h2><span class="badge b-amber">Estimated — requires owner approval</span></div>';
    var months = [St.today.slice(0, 7), lastMonth()].map(function (m, i) { return [m, U.monthLabel(m) + (i ? '' : ' (to date)')]; });
    var monthSel = U.field('Month', '<select id="sl-ym" data-sl="ym">' + U.options(months, F.sl.ym) + '</select>', { for: 'sl-ym' });
    if (F.sl.err) return head + '<div class="empty">' + esc(F.sl.err) + '<br><button class="btn sm" data-a="sl-retry">Try again</button></div></section>';
    if (!d) { loadSalary(F.sl.ym); return head + '<div class="empty"><div class="spinner" aria-hidden="true"></div>Working out estimates…</div></section>'; }
    if (!d.rows.length) return head + '<div class="empty">No staff yet.</div></section>';
    if (!F.sl.sid || !d.rows.some(function (r) { return r.staffId === F.sl.sid; })) F.sl.sid = d.rows[0].staffId;
    var row = d.rows.filter(function (r) { return r.staffId === F.sl.sid; })[0], R = row.result, o = row.overrides || {};
    function num(name, label, val, step, hint) { return U.field(label, '<input id="sl-' + name + '" name="' + name + '" type="number" min="0" step="' + (step || 1) + '" value="' + (val == null ? '' : val) + '">', { for: 'sl-' + name, hint: hint }); }
    var owner = St.role === 'owner';
    return head + '<div class="sal-grid"><form class="sal-in" id="sl-form" novalidate><div class="grid2">' +
      U.field('Employee', '<select id="sl-sid" data-sl="sid">' + U.options(d.rows.map(function (r) { return [r.staffId, r.name + (r.status === 'approved' ? ' ✓' : '')]; }), F.sl.sid) + '</select>', { for: 'sl-sid' }) + monthSel +
      num('monthlySalary', 'Monthly salary (₹)', o.monthlySalary != null ? o.monthlySalary : (R.basis === 'monthly' ? Math.round(R.perDay * R.divisor) : ''), 100) +
      num('divisor', 'Divide salary by (days)', o.divisor != null ? o.divisor : R.divisor, 1, 'Days in the month by default; some use 30 or 26') +
      num('overtimeHours', 'Overtime (hours)', R.overtimeHours, 0.5, 'From check-in/out beyond the shift') +
      num('overtimeRate', 'Overtime rate (₹ per hour)', R.overtimeRate, 1, 'Labour codes: 2× the normal hourly rate') +
      '</div><label class="switch" style="margin:4px 0 12px"><input type="checkbox" name="leavePaid"' + (R.leavePaid ? ' checked' : '') + '><span></span>Approved leave is paid</label>' +
      '<div><button class="btn sm" type="submit">' + ic('refresh') + 'Recalculate with these inputs</button></div>' +
      (row.unmarked ? '<p class="warn" style="margin-top:10px">' + ic('alert') + '<span>' + row.unmarked + ' day(s) are not marked this month. Mark them for an accurate estimate.</span></p>' : '') + '</form>' +
      '<div class="sal-out"><small>Estimated payable salary · ' + esc(row.name) + (d.partialMonth ? ' · month to date' : '') + '</small><b class="big">' + U.inr(R.net) + '</b>' +
      '<dl class="calc"><dt>Per-day rate</dt><dd>' + U.inr2(R.perDay) + '</dd><dt>Payable days</dt><dd>' + R.payableDays + '</dd><dt>Base pay</dt><dd>' + U.inr(R.base) + '</dd><dt>Overtime</dt><dd>+' + U.inr(R.overtime) + '</dd>' +
      (R.advance ? '<dt>Advances (from HisaabNow)</dt><dd>−' + U.inr(R.advance) + '</dd>' : '') + '<dt class="tot">Estimate</dt><dd class="tot">' + U.inr(R.net) + '</dd></dl>' +
      '<details class="formula"><summary>How this was worked out</summary><ul>' + R.formula.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></details>' +
      (R.missing && R.missing.length ? '<div class="warn">' + ic('alert') + '<span>Missing: ' + esc(R.missing.join(', ')) + '.</span></div>' : '') +
      '<div class="warn">' + ic('alert') + '<span><b>Estimated — owner approval required.</b> Staff360 never pays salaries.</span></div>' +
      (row.status === 'approved' ? '<p class="ok-note">' + ic('check') + 'Approved' + (row.approvedAt ? ' on ' + U.dLabel(new Date(row.approvedAt).toISOString().slice(0, 10)) : '') + '. No payment was made.</p>' :
        owner ? '<button class="btn pri" data-a="sl-approve" style="width:100%">' + ic('check') + 'Approve this estimate</button>' : '<p class="muted small">Only the owner can approve estimates.</p>') +
      '</div></div></section>';
  }
  document.addEventListener('change', function (e) {
    var k = e.target.getAttribute && e.target.getAttribute('data-sl'); if (!k) return;
    F.sl[k] = e.target.value; U.render();
  });
  document.addEventListener('submit', function (e) {
    if (e.target.id !== 'sl-form') return; e.preventDefault();
    var f = e.target, o = {};
    ['monthlySalary', 'divisor', 'overtimeHours', 'overtimeRate'].forEach(function (k) { var v = U.val(f, k); if (v !== '') o[k] = +v; });
    o.leavePaid = U.val(f, 'leavePaid');
    var b = f.querySelector('button[type=submit]'); b.disabled = true; b.textContent = 'Recalculating…';
    St.backend().salarySave(F.sl.sid, F.sl.ym, o).then(function (r) {
      U.clean(f); var d = F.sl.data[F.sl.ym]; d.rows = d.rows.map(function (x) { return x.staffId === r.row.staffId ? r.row : x; }); U.render(); U.toast('Estimate updated');
    }, function (err) { b.disabled = false; b.textContent = 'Recalculate with these inputs'; U.toast(err.userMessage || 'Couldn’t recalculate'); });
  });
  U.actions['sl-retry'] = function () { F.sl.err = ''; U.render(); };
  U.actions['sl-approve'] = function () {
    var d = F.sl.data[F.sl.ym], row = d.rows.filter(function (r) { return r.staffId === F.sl.sid; })[0];
    U.confirm('Approve ' + U.inr(row.result.net) + ' for ' + esc(row.name) + '?', 'This records your approval of the estimate for ' + U.monthLabel(F.sl.ym) + '. <b>No money is paid</b> — you pay salaries yourself as usual.', 'Approve estimate', function () {
      St.approveSalary(row.staffId, F.sl.ym, row.result.net, {}).then(function () { delete F.sl.data[F.sl.ym]; U.render(); U.toast('Estimate approved for ' + row.name + '. No payment was made.'); });
    });
  };
})();
