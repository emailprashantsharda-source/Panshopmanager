/* Staff360 v2 — SAMPLE DATA ONLY.
 * Deterministic demo dataset for a kirana / general store team. Nothing here touches
 * Firebase or production data. Swap this file for the server adapter after approval.
 */
(function () {
  'use strict';

  // Seeded RNG so every reload shows the same sample data.
  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function toMin(hhmm) { var p = hhmm.split(':'); return +p[0] * 60 + +p[1]; }

  var business = { id: 'demo-kiran', name: 'Kiran General Store', city: 'Noida', owner: 'Rahul Gupta', ownerFirst: 'Rahul' };
  var businesses = [business, { id: 'demo-kiran-2', name: 'Kiran General Store', city: 'Sector 62, Noida' }];

  var shifts = [
    { id: 'morning', name: 'Morning', start: '09:00', end: '18:00', graceMin: 10, breakMin: 60, color: 'blue' },
    { id: 'evening', name: 'Evening', start: '14:00', end: '23:00', graceMin: 10, breakMin: 45, color: 'purple' },
    { id: 'general', name: 'General', start: '10:00', end: '19:00', graceMin: 15, breakMin: 60, color: 'green' },
  ];

  // weeklyOff: 0 = Sunday … 6 = Saturday
  var staff = [
    ['HN001', 'Amit Kumar', '9876543210', 'Sales Executive', '2025-01-10', 'Full-time', 'general', 2, 16000],
    ['HN002', 'Pooja Sharma', '9876543211', 'Cashier', '2025-02-15', 'Full-time', 'morning', 0, 15000],
    ['HN003', 'Vikas Verma', '9876543212', 'Store Manager', '2024-01-01', 'Full-time', 'morning', 0, 28000],
    ['HN004', 'Sunita Jha', '9876543213', 'Helper', '2025-03-12', 'Full-time', 'general', 1, 11000],
    ['HN005', 'Mohit Singh', '9876543214', 'Delivery', '2025-04-05', 'Full-time', 'general', 3, 13000],
    ['HN006', 'Neha Yadav', '9876543215', 'Cashier', '2025-06-20', 'Full-time', 'evening', 1, 15000],
    ['HN007', 'Arjun Rawat', '9876543216', 'Stock Keeper', '2024-09-02', 'Full-time', 'morning', 4, 14000],
    ['HN008', 'Imran Khan', '9876543217', 'Delivery', '2025-07-14', 'Full-time', 'evening', 2, 13000],
    ['HN009', 'Kavita Devi', '9876543218', 'Helper', '2025-08-01', 'Part-time', 'general', 0, 8000],
    ['HN010', 'Rohit Chauhan', '9876543219', 'Sales Executive', '2025-05-11', 'Full-time', 'evening', 5, 16000],
    ['HN011', 'Deepak Mishra', '9876543220', 'Delivery', '2025-10-03', 'Full-time', 'morning', 6, 13000],
    ['HN012', 'Anjali Saxena', '9876543221', 'Billing Assistant', '2025-11-21', 'Full-time', 'general', 3, 14500],
    ['HN013', 'Suresh Pal', '9876543222', 'Helper', '2026-11-03', 'Full-time', 'morning', 2, 11000],
    ['HN014', 'Priya Nair', '9876543223', 'Sales Executive', '2026-11-10', 'Full-time', 'general', 5, 16000],
    ['HN015', 'Manoj Tiwari', '9876543224', 'Security Guard', '2024-06-15', 'Contract', 'evening', 0, 12000],
  ].map(function (r, i) {
    return {
      id: r[0], name: r[1], mobile: r[2], designation: r[3], joined: r[4], type: r[5],
      shift: r[6], weeklyOff: r[7], salary: r[8], status: r[0] === 'HN015' ? 'Inactive' : 'Active',
      login: i % 3 !== 2, // Premium: employee login enabled for most staff
    };
  });

  // Demo "now": today's date, with the clock held inside working hours so the
  // dashboard always shows a realistic mid-day picture.
  var real = new Date();
  var today = new Date(real.getFullYear(), real.getMonth(), real.getDate());
  var nowMin = Math.min(Math.max(real.getHours() * 60 + real.getMinutes(), 12 * 60 + 10), 20 * 60 + 30);

  var leaves = [
    { id: 'L1', staff: 'HN002', type: 'Casual', from: 1, to: 2, reason: 'Personal work', status: 'Pending', applied: -1 },
    { id: 'L2', staff: 'HN005', type: 'Sick', from: -1, to: -1, reason: 'Fever and rest', status: 'Approved', applied: -2 },
    { id: 'L3', staff: 'HN004', type: 'Casual', from: 5, to: 6, reason: 'Family function', status: 'Pending', applied: 0 },
    { id: 'L4', staff: 'HN001', type: 'Unpaid', from: 9, to: 11, reason: 'Out of station', status: 'Rejected', applied: -3 },
    { id: 'L5', staff: 'HN009', type: 'Sick', from: 0, to: 0, reason: 'Doctor appointment', status: 'Approved', applied: -1 },
    { id: 'L6', staff: 'HN010', type: 'Other', from: 3, to: 3, reason: 'Bank work', status: 'Pending', applied: 0 },
    { id: 'L7', staff: 'HN006', type: 'Casual', from: -8, to: -7, reason: 'Wedding in family', status: 'Approved', applied: -12 },
  ].map(function (l) {
    var f = addDays(today, l.from), t = addDays(today, l.to);
    return { id: l.id, staff: l.staff, type: l.type, from: iso(f), to: iso(t), days: l.to - l.from + 1,
             reason: l.reason, status: l.status, applied: iso(addDays(today, l.applied)) };
  });
  function onLeave(sid, d) {
    var k = iso(d);
    return leaves.some(function (l) { return l.staff === sid && l.status === 'Approved' && k >= l.from && k <= l.to; });
  }

  function fmt(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }

  // Attendance records: { date, staff, status, in, out, remark }
  // status: present | late | halfday | absent | leave | weeklyoff
  var attendance = [];
  var forcedToday = { HN004: 'absent', HN011: 'late', HN008: 'late' };
  staff.forEach(function (s, idx) {
    var R = rng(1000 + idx * 7919);
    var sh = shifts.filter(function (x) { return x.id === s.shift; })[0];
    var start = toMin(sh.start), end = toMin(sh.end);
    var joined = new Date(s.joined + 'T00:00:00');
    for (var back = 60; back >= 0; back--) {
      var d = addDays(today, -back);
      if (d < joined) continue;
      var isToday = back === 0;
      if (s.status === 'Inactive' && back < 20) continue;
      var rec = { date: iso(d), staff: s.id, status: 'present', in: null, out: null, remark: '' };
      var roll = R();
      if (d.getDay() === s.weeklyOff) rec.status = 'weeklyoff';
      else if (onLeave(s.id, d)) rec.status = 'leave';
      else if (isToday && forcedToday[s.id]) rec.status = forcedToday[s.id];
      else if (!isToday && roll < 0.05) rec.status = 'absent';
      else if (!isToday && roll < 0.09) rec.status = 'halfday';
      else if (roll < 0.19) rec.status = 'late';
      if (rec.status === 'present' || rec.status === 'late' || rec.status === 'halfday') {
        var inM = rec.status === 'late' ? start + sh.graceMin + 2 + Math.floor(R() * 35) : start - 15 + Math.floor(R() * (sh.graceMin + 14));
        var outM = rec.status === 'halfday' ? start + 4 * 60 + Math.floor(R() * 40) : end - 10 + Math.floor(R() * 45);
        if (isToday) {
          if (inM > nowMin) { rec.status = 'notin'; inM = null; }
          if (outM > nowMin) outM = null;
        }
        rec.in = inM == null ? null : fmt(inM);
        rec.out = outM == null ? null : fmt(Math.min(outM, 23 * 60 + 50));
        if (rec.status === 'halfday') rec.remark = 'Left early — informed manager';
      }
      attendance.push(rec);
    }
  });

  var corrections = [
    { id: 'C1', staff: 'HN011', date: iso(addDays(today, -1)), want: { in: '09:05' }, reason: 'Phone battery died, I reached at 9:05', status: 'Pending', applied: iso(today) },
  ];
  var notifications = [
    { id: 'n1', text: '3 leave requests are waiting for approval', at: '10 min ago', go: '#/leave' },
    { id: 'n2', text: 'Imran Khan checked in 28 min late', at: '1 hr ago', go: '#/attendance' },
    { id: 'n3', text: 'Sunita Jha has not checked in today', at: '2 hr ago', go: '#/attendance' },
  ];

  window.S360_MOCK = {
    sample: true,
    business: business, businesses: businesses, shifts: shifts, staff: staff,
    attendance: attendance, leaves: leaves, notifications: notifications, corrections: corrections,
    today: iso(today), nowMin: nowMin,
  };
})();
