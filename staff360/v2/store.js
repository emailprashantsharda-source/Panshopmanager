/* Staff360 v2 — in-memory store, selectors and plan gating.
 * The UI only talks to S360Store. Today it is backed by S360_MOCK; after approval the
 * same methods call the existing staff360* Cloud Functions.
 */
(function () {
  'use strict';
  var M = window.S360_MOCK;
  var subs = [];
  var PLANS = ['basic', 'premium', 'kingpro'];
  var PLAN_LABEL = { basic: 'Basic', premium: 'Premium', kingpro: 'King PRO' };
  // Feature → minimum plan. Mirrors functions-staff360/staff360/core.js FEATURES.
  var FEATURE = {
    dashboard: 'basic', staff: 'basic', attendance: 'basic', history: 'basic',
    checkin_metrics: 'premium', employee_portal: 'premium', gps: 'premium', shifts: 'premium',
    leave: 'premium', reports_advanced: 'premium', employee_login: 'premium',
    ai: 'kingpro', insights: 'kingpro', salary: 'kingpro', anomalies: 'kingpro',
  };

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }

  var S = {
    plan: PLANS.indexOf(lsGet('s360v2.plan', 'kingpro')) >= 0 ? lsGet('s360v2.plan', 'kingpro') : 'kingpro',
    staff: M.staff.slice(), attendance: M.attendance.slice(), leaves: M.leaves.slice(),
    shifts: M.shifts.slice(), notifications: M.notifications.slice(),
  };

  function emit() { subs.forEach(function (f) { f(); }); }
  function rank(p) { return PLANS.indexOf(p); }

  var api = {
    sample: M.sample, business: M.business, businesses: M.businesses, today: M.today, nowMin: M.nowMin,
    PLAN_LABEL: PLAN_LABEL,
    subscribe: function (f) { subs.push(f); },
    get plan() { return S.plan; },
    setPlan: function (p) { if (rank(p) < 0) return; S.plan = p; lsSet('s360v2.plan', p); emit(); },
    can: function (feature) { return rank(S.plan) >= rank(FEATURE[feature] || 'kingpro'); },
    needs: function (feature) { return PLAN_LABEL[FEATURE[feature] || 'kingpro']; },

    staff: function (opts) {
      opts = opts || {};
      return S.staff.filter(function (s) { return opts.all || s.status === 'Active'; });
    },
    person: function (id) { return S.staff.filter(function (s) { return s.id === id; })[0]; },
    shift: function (id) { return S.shifts.filter(function (s) { return s.id === id; })[0]; },
    shifts: function () { return S.shifts; },
    notifications: function () { return S.notifications; },
    leaves: function () { return S.leaves; },
    record: function (sid, date) {
      return S.attendance.filter(function (a) { return a.staff === sid && a.date === date; })[0] || null;
    },
    day: function (date) {
      return api.staff().map(function (s) { return { person: s, rec: api.record(s.id, date) }; });
    },
    range: function (from, to) {
      return S.attendance.filter(function (a) { return a.date >= from && a.date <= to; });
    },

    // ---- actions (mutate demo state only) ----
    decideLeave: function (id, status) {
      S.leaves.forEach(function (l) { if (l.id === id) l.status = status; });
      emit();
    },
  };
  window.S360Store = api;
})();
