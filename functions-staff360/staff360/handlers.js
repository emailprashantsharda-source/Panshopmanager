/* HisaabNow Staff360 — callable handlers.
 *
 * Every handler: (data, auth) -> result. Firebase is injected so the whole
 * authorisation + plan-gating path runs in unit tests against an in-memory
 * Firestore (see test/handlers.test.js).
 *
 * DATA LAYOUT (server-owned; clients never write these directly):
 *   staff360Entitlements/{shopId}            plan + subscription state
 *   staff360Config/plans                     admin-set prices / staff limits
 *   staff360/{shopId}                        settings (timezone, GPS policy)
 *   staff360/{shopId}/punches/{staffId_date} one doc per staff per day
 *   staff360/{shopId}/punchLog/{autoId}      every punch attempt (dup detection)
 *   staff360/{shopId}/shifts/{shiftId}
 *   staff360/{shopId}/requests/{reqId}
 *   staff360/{shopId}/audit/{autoId}
 *   staff360/{shopId}/insights/{insightId}   reviewed / dismissed state
 *   staff360/{shopId}/salary/{ym_staffId}    owner-editable draft estimates
 *   staff360/{shopId}/aiUsage/{yyyymmdd}     rate-limit counters (no chat text)
 *   staff360/{shopId}/whatsapp/settings      opt-in settings
 *   staff360/{shopId}/whatsappLog/{autoId}   delivery log
 *   staff360WaSchedule/{shopId}              index for the scheduled sender
 *
 * Existing HisaabNow data that is READ (never restructured):
 *   shops/{shopId}                     ownerId, name
 *   staffPhoneIndex/{phone}/shops/*    staff memberships (role, active)
 *   shops/{shopId}/staff/{staffId}     name, role, phoneE164, salary
 *   shops/{shopId}/agents/att_{sid}_{ym}  Step ATT month marks (Basic)
 * Written into existing data (mirror only, flag-guarded):
 *   shops/{shopId}/agents/att_{sid}_{ym}.days.{date}  so Step ATT's month
 *   report and salary keep working with employee punches.
 */
'use strict';
const C = require('./core');

const AI_DAILY_LIMIT_DEFAULT = 40;
const MAX_RANGE_DAYS = 92;

function createHandlers(deps) {
  const { db, HttpsError } = deps;
  const now = deps.now || (() => Date.now());
  const ai = deps.ai || { configured: () => false };
  const wa = deps.wa || { configured: () => false };
  const env = deps.env || {};

  const fail = (code, msg) => { throw new HttpsError(code, msg); };

  /* Two kinds of tenant share every Staff360 feature:
   *   HisaabNow shop  — shops/{shopId}            (attendance marks in shops/{id}/agents/att_*)
   *   Staff360 org    — staff360Orgs/{s360_...}   (standalone product; marks in staff360/{id}/marks/att_*)
   * Org ids always start with "s360_" so they can never collide with a shop id. */
  const isOrgId = (id) => /^s360_[A-Za-z0-9]{8,40}$/.test(String(id || ''));
  const tenantDocPath = (id) => (isOrgId(id) ? `staff360Orgs/${id}` : `shops/${id}`);
  const markDocPath = (id, sid, ym) => (isOrgId(id) ? `staff360/${id}/marks/att_${sid}_${ym}` : `shops/${id}/agents/att_${sid}_${ym}`);
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);

  /* ───────────── identity & tenancy ───────────── */

  async function caller(data, auth, opts) {
    if (!auth || !auth.uid) fail('unauthenticated', 'Please sign in.');
    const shopId = str(data && data.shopId, 128);
    if (!shopId || shopId.includes('/')) fail('invalid-argument', 'shopId required');
    const shopSnap = await db.doc(tenantDocPath(shopId)).get();
    if (!shopSnap.exists) fail('not-found', 'Business not found');
    const shop = shopSnap.data() || {};
    const kind = isOrgId(shopId) ? 'org' : 'shop';
    let role = null;
    let membership = null;
    if (shop.ownerId && shop.ownerId === auth.uid) role = 'owner';
    const phone = auth.token && auth.token.phone_number;
    if (!role && phone && kind === 'shop') {
      // Same source the Firestore rules trust (isStaffOf): the CF-written
      // login record shops/{shopId}/staff/{phoneE164}.
      const sd = await db.doc(`shops/${shopId}/staff/${phone}`).get();
      const m = sd.exists ? sd.data() : null;
      if (m && m.active !== false && m._deleted !== true) {
        membership = m; role = String(m.role || '').toLowerCase() === 'manager' ? 'manager' : 'employee';
      }
    }
    if (!role && phone) {
      // Staff360 login granted by the owner on the roster (works for orgs and
      // for HisaabNow shops, e.g. stylists who have no HisaabNow login).
      const r = await db.collection(`staff360/${shopId}/roster`).where('phoneE164', '==', phone).limit(5).get();
      const m = r.docs.map((d) => Object.assign({ id: d.id }, d.data())).find((x) => x.canLogin === true && !x.removed && x.active !== false);
      if (m) { membership = m; role = String(m.role || '').toLowerCase() === 'manager' ? 'manager' : 'employee'; }
    }
    if (!role) fail('permission-denied', 'You do not have access to this business.');
    const ent = C.resolveEntitlement((await db.doc(`staff360Entitlements/${shopId}`).get()).data(), now());
    const ctx = { shopId, shop, kind, role, uid: auth.uid, phone: phone || null, membership, ent, plan: ent.planId };
    if (opts && opts.roles && !opts.roles.includes(role)) fail('permission-denied', 'Your role cannot do this.');
    if (opts && opts.feature && !C.can(ctx.plan, opts.feature)) {
      fail('failed-precondition', `upgrade_required:${C.FEATURES[opts.feature] >= 3 ? 'kingpro' : 'premium'}`);
    }
    return ctx;
  }
  const MANAGERS = ['owner', 'manager'];

  async function settings(shopId) {
    const s = (await db.doc(`staff360/${shopId}`).get()).data() || {};
    return {
      timezone: C.validTz(s.timezone) ? s.timezone : C.DEFAULT_TZ,
      gpsPolicy: s.gpsPolicy === 'allow_without' ? 'allow_without' : 'require',
      minAccuracyM: Number.isFinite(s.minAccuracyM) ? Math.min(5000, Math.max(10, s.minAccuracyM)) : 150,
      mirrorToRegister: s.mirrorToRegister !== false,
      lateThreshold: Number.isInteger(s.lateThreshold) ? Math.max(2, Math.min(15, s.lateThreshold)) : 3,
      defaultGraceMin: Number.isFinite(s.defaultGraceMin) ? s.defaultGraceMin : 10,
      hoursPerDay: Number.isFinite(s.hoursPerDay) ? s.hoursPerDay : 8,
      halfDayBelowHours: Number.isFinite(s.halfDayBelowHours) ? s.halfDayBelowHours : 5,
      autoLate: s.autoLate !== false,
      autoHalfDay: s.autoHalfDay === true,
      autoAbsent: s.autoAbsent === true,
      geofence: s.geofence && Number.isFinite(s.geofence.lat) && Number.isFinite(s.geofence.lng)
        ? { lat: s.geofence.lat, lng: s.geofence.lng, radiusM: s.geofence.radiusM || 200, mode: ['flag', 'block'].includes(s.geofence.mode) ? s.geofence.mode : 'off' }
        : { lat: null, lng: null, radiusM: 200, mode: 'off' },
      perms: Object.assign({ requestLeave: true, seeShift: true, managerEdit: true, managerSalary: false }, s.perms || {}),
      notify: Object.assign({ dailySummary: false, lateAlert: false, leaveAlert: true }, s.notify || {}),
    };
  }
  const EMP_TYPES = ['Full-time', 'Part-time', 'Contract', 'Temporary'];
  // Straight-line distance in metres between two GPS points.
  function distanceM(a, b) {
    const R = 6371000, rad = (x) => x * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  }
  // Outside only if even the most generous reading (distance minus GPS accuracy) is past the radius.
  function fenceCheck(gf, gps) {
    if (!gps || !gf || gf.mode === 'off' || gf.lat == null) return null;
    const d = distanceM(gf, gps);
    return { distanceM: d, outside: d - Math.min(gps.accuracy || 0, 150) > gf.radiusM };
  }
  const LEAVE_TYPES = ['Casual', 'Sick', 'Unpaid', 'Other'];

  /* Staff = the owner's roster (sent by the app via syncRoster, because the
   * app's staff list is NOT pushed to Firestore — HisaabSync NO_PUSH) plus
   * any login record (shops/{shopId}/staff/{phone}) whose phone is not
   * already on the roster. Roster ids are the ids Step ATT uses. */
  async function staffList(shopId) {
    const [logins, roster] = await Promise.all([
      isOrgId(shopId) ? Promise.resolve({ docs: [] }) : db.collection(`shops/${shopId}/staff`).get(),
      db.collection(`staff360/${shopId}/roster`).get(),
    ]);
    const out = roster.docs.map((d) => Object.assign({ id: d.id }, d.data()))
      .filter((s) => s && !s.removed && s.active !== false);
    const phones = new Set(out.map((s) => s.phoneE164).filter(Boolean));
    for (const d of logins.docs) {
      const s = Object.assign({ id: d.id }, d.data());
      if (!s || s._deleted || s.deletedAt || s.active === false) continue;
      const ph = s.phoneE164 || (String(d.id).startsWith('+') ? d.id : null);
      if (ph && phones.has(ph)) continue;
      if (!s.phoneE164 && ph) s.phoneE164 = ph;
      out.push(s);
    }
    return out;
  }

  async function selfStaff(ctx) {
    if (!ctx.phone) fail('failed-precondition', 'Your login has no phone number.');
    // Prefer the roster id (what Step ATT and the owner's reports use).
    const r = await db.collection(`staff360/${ctx.shopId}/roster`).where('phoneE164', '==', ctx.phone).limit(5).get();
    const fromRoster = r.docs.map((d) => Object.assign({ id: d.id }, d.data())).find((x) => !x.removed && x.active !== false);
    if (fromRoster) return Object.assign({}, ctx.membership || {}, fromRoster);
    const sd = ctx.kind === 'shop' ? await db.doc(`shops/${ctx.shopId}/staff/${ctx.phone}`).get() : { exists: false };
    const s = sd.exists ? Object.assign({ id: sd.id }, sd.data()) : null;
    if (!s || s._deleted || s.deletedAt || s.active === false) fail('not-found', 'No staff profile matches your phone number. Ask the owner to add you.');
    return s;
  }

  /* Owner/manager app sends its full staff list so server reports, AI and
   * salary drafts include staff who have no login. Full replace: anyone
   * missing from the list is marked removed (never deleted — history stays). */
  async function syncRoster(data, auth) {
    const ctx = await caller(data, auth, { roles: MANAGERS, feature: 'staff_manage' });
    const list = Array.isArray(data.staff) ? data.staff.slice(0, 500) : null;
    if (!list) fail('invalid-argument', 'staff list required');
    const coll = db.collection(`staff360/${ctx.shopId}/roster`);
    const seen = new Set(), writes = [];
    for (const x of list) {
      const id = str(x && x.id, 128);
      if (!id || id.includes('/') || seen.has(id)) continue;
      seen.add(id);
      const ph = str(x.phoneE164 || x.phone, 20).replace(/[^\d+]/g, '');
      const doc = {
        name: str(x.name, 80) || 'Staff', role: str(x.role, 40),
        salary: Math.max(0, Math.min(1e7, Number(x.salary) || 0)), active: x.active !== false, removed: false,
        updatedAt: now(), updatedBy: ctx.uid,
      };
      // Keep a phone added in Staff360 when the app's staff record has none.
      const phone = /^\+\d{10,15}$/.test(ph) ? ph : (/^\d{10}$/.test(ph) ? '+91' + ph : null);
      if (phone) doc.phoneE164 = phone;
      writes.push(coll.doc(id).set(doc, { merge: true }));
    }
    /* Remove only staff the app says were deleted. Staff merely missing from this
     * device's list stay: a phone that hasn't finished downloading the shop's data,
     * or an older copy of the app, must never wipe the team. */
    const gone = Array.isArray(data.removed) ? data.removed.slice(0, 500).map((r) => str(r, 128)).filter((r) => r && !r.includes('/') && !seen.has(r)) : [];
    for (const id of new Set(gone)) writes.push(coll.doc(id).set({ removed: true, updatedAt: now() }, { merge: true }));
    await Promise.all(writes);
    return { ok: true, count: seen.size, removed: gone.length };
  }

  async function shifts(shopId) {
    const q = await db.collection(`staff360/${shopId}/shifts`).get();
    return q.docs.map((d) => Object.assign({ id: d.id }, d.data())).filter((s) => !s.deleted);
  }
  function shiftFor(list, staffId) { return list.find((s) => Array.isArray(s.staffIds) && s.staffIds.includes(staffId)) || null; }

  async function audit(ctx, entry) {
    await db.collection(`staff360/${ctx.shopId}/audit`).add(Object.assign({
      at: now(), actorUid: ctx.uid, actorRole: ctx.role,
    }, entry));
  }

  /* ───────────── data loading for a range ───────────── */

  function checkRange(from, to) {
    if (!C.isDate(from) || !C.isDate(to) || from > to) fail('invalid-argument', 'Invalid date range');
    if (C.dateRange(from, to, MAX_RANGE_DAYS + 1).length > MAX_RANGE_DAYS) fail('invalid-argument', `Range is limited to ${MAX_RANGE_DAYS} days`);
  }

  async function loadRange(shopId, from, to, staffFilter) {
    const staff = (await staffList(shopId)).filter((s) => !staffFilter || s.id === staffFilter);
    const months = Array.from(new Set(C.dateRange(from, to).map((d) => d.slice(0, 7))));
    const marks = {};
    await Promise.all(staff.map(async (s) => {
      marks[s.id] = {};
      for (const ym of months) {
        const snap = await db.doc(markDocPath(shopId, s.id, ym)).get();
        const d = snap.exists ? snap.data() : null;
        if (d && !d._deleted && d.days && typeof d.days === 'object') {
          for (const k of Object.keys(d.days)) if (k >= from && k <= to) marks[s.id][k] = d.days[k];
        }
      }
    }));
    const punches = {};
    const pq = await db.collection(`staff360/${shopId}/punches`)
      .where('attendanceDate', '>=', from).where('attendanceDate', '<=', to).get();
    for (const d of pq.docs) {
      const p = Object.assign({ id: d.id }, d.data());
      if (staffFilter && p.staffId !== staffFilter) continue;
      (punches[p.staffId] = punches[p.staffId] || {})[p.attendanceDate] = p;
    }
    return { staff, marks, punches };
  }

  async function mirrorMark(shopId, staffId, date, patch) {
    const ref = db.doc(markDocPath(shopId, staffId, date.slice(0, 7)));
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const cur = snap.exists ? (snap.data().days || {})[date] || {} : {};
      const next = Object.assign({}, cur, patch);
      for (const k of Object.keys(next)) if (next[k] == null || next[k] === '') delete next[k];
      if (snap.exists) tx.update(ref, { [`days.${date}`]: next, _lastUpdated: now() });
      else tx.set(ref, { id: `att_${staffId}_${date.slice(0, 7)}`, kind: 'hn_att', staffId, ym: date.slice(0, 7), days: { [date]: next }, _lastUpdated: now() });
    });
  }

  /* ═════════════════════════ handlers ═════════════════════════ */

  /* Who am I here, what plan, what may I do. Safe for every role. */
  async function getState(data, auth) {
    const ctx = await caller(data, auth);
    const cfg = C.mergePlanConfig(((await db.doc('staff360Config/plans').get()).data()) || {});
    const out = {
      serverTime: now(), // client uses this to correct device-clock skew on GPS timestamps
      tenant: { id: ctx.shopId, kind: ctx.kind, name: ctx.shop.name || '' },
      role: ctx.role, plan: ctx.plan, entitlement: ctx.ent,
      features: C.entitlementMap(ctx.plan), plans: cfg,
      ai: { configured: !!ai.configured() }, whatsapp: { providerConfigured: !!wa.configured() },
      billing: { online: !!(env.STAFF360_BILLING_ENABLED === 'true') },
    };
    if (MANAGERS.includes(ctx.role)) {
      out.settings = await settings(ctx.shopId);
      out.staffCount = (await staffList(ctx.shopId)).length;
    }
    if (ctx.role === 'employee' || (ctx.role === 'manager' && ctx.phone)) {
      try {
        const me = await selfStaff(ctx);
        const st = await settings(ctx.shopId);
        const z = C.zoned(now(), st.timezone);
        const sh = shiftFor(await shifts(ctx.shopId), me.id);
        const today = (await db.doc(`staff360/${ctx.shopId}/punches/${me.id}_${z.date}`).get()).data() || null;
        const yest = (await db.doc(`staff360/${ctx.shopId}/punches/${me.id}_${C.addDays(z.date, -1)}`).get()).data() || null;
        out.me = {
          staffId: me.id, name: me.name || 'Staff', role: me.role || '', today: z.date, timezone: st.timezone,
          weeklyOff: Number.isInteger(me.weeklyOff) ? me.weeklyOff : null, joinedDate: me.joinedDate || null,
          gpsPolicy: st.gpsPolicy, minAccuracyM: st.minAccuracyM, fence: { mode: st.geofence.mode, radiusM: st.geofence.radiusM },
          shift: sh ? { name: sh.name, start: sh.start, end: sh.end, graceMin: sh.graceMin || 0, weeklyOff: sh.weeklyOff || [] } : null,
          todayPunch: publicPunch(today), openYesterday: yest && yest.checkInAt && !yest.checkOutAt ? publicPunch(yest) : null,
        };
      } catch (e) {
        if (ctx.role === 'employee') out.me = { error: e.message };
      }
    }
    return out;
  }

  function publicPunch(p) {
    if (!p) return null;
    return {
      attendanceDate: p.attendanceDate, checkInAt: p.checkInAt || null, checkOutAt: p.checkOutAt || null,
      inHm: p.inHm || '', outHm: p.outHm || '', lateMinutes: p.lateMinutes || 0, earlyLeaveMinutes: p.earlyLeaveMinutes || 0,
      workedMinutes: p.workedMinutes || 0,
      checkInGps: p.checkInGps ? { accuracy: p.checkInGps.accuracy, lowAccuracy: !!p.checkInGps.lowAccuracy, distanceM: p.checkInGps.distanceM, outside: !!p.checkInGps.outside } : null,
      checkOutGps: p.checkOutGps ? { accuracy: p.checkOutGps.accuracy, lowAccuracy: !!p.checkOutGps.lowAccuracy } : null,
      checkInGpsStatus: p.checkInGpsStatus || null, checkOutGpsStatus: p.checkOutGpsStatus || null,
      source: p.source || 'employee',
    };
  }

  /* Employee check-in / check-out. Server time is authoritative. */
  async function punch(data, auth) {
    const ctx = await caller(data, auth, { feature: 'self_checkin' });
    const action = data && data.action;
    if (action !== 'in' && action !== 'out') fail('invalid-argument', 'action must be in or out');
    const me = await selfStaff(ctx);
    const st = await settings(ctx.shopId);
    const t = now();
    const z = C.zoned(t, st.timezone);
    const gps = C.cleanGps(data.gps, t);
    const gpsErr = C.GPS_ERRORS.includes(data.gpsError) ? data.gpsError : (gps ? null : 'unavailable');
    const logRef = db.collection(`staff360/${ctx.shopId}/punchLog`);
    const log = (outcome, date) => logRef.add({ staffId: me.id, staffName: me.name || '', action, attendanceDate: date || z.date, at: t, hm: z.hm, outcome });

    // "Don't allow check-ins away from the shop" can't be dodged by switching location off.
    if (!gps && (st.gpsPolicy === 'require' || (action === 'in' && st.geofence.mode === 'block' && st.geofence.lat != null))) {
      await log('rejected_no_gps');
      fail('failed-precondition', `gps_required:${gpsErr}`);
    }
    const fence = fenceCheck(st.geofence, gps);
    if (fence && fence.outside && st.geofence.mode === 'block') {
      await log('rejected_outside');
      fail('failed-precondition', `outside_radius:${fence.distanceM}`);
    }
    const gpsDoc = gps ? Object.assign({}, gps, { lowAccuracy: gps.accuracy > st.minAccuracyM }, fence || {}) : null;
    const sh = shiftFor(await shifts(ctx.shopId), me.id);

    if (action === 'in') {
      const ref = db.doc(`staff360/${ctx.shopId}/punches/${me.id}_${z.date}`);
      const res = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists && snap.data().checkInAt) {
          return { dup: snap.data().checkOutAt ? 'already_completed' : 'already_checked_in', p: snap.data() };
        }
        const p = {
          shopId: ctx.shopId, staffId: me.id, staffName: me.name || '', attendanceDate: z.date, timezone: st.timezone,
          shiftId: sh ? sh.id : null, shiftSnapshot: sh ? { name: sh.name, start: sh.start, end: sh.end, graceMin: sh.graceMin || 0 } : null,
          status: 'P', checkInAt: t, inHm: z.hm, checkOutAt: null, outHm: '',
          lateMinutes: sh ? C.lateMinutes(sh, z.minutes) : 0, earlyLeaveMinutes: 0, workedMinutes: 0,
          checkInGps: gpsDoc, checkInGpsStatus: gps ? 'captured' : gpsErr,
          clientTs: Number(data.clientTs) || null, source: 'employee', createdBy: ctx.uid, updatedBy: ctx.uid,
          createdAt: t, updatedAt: t,
        };
        tx.set(ref, p);
        return { p };
      });
      if (res.dup) { await log(res.dup); fail('already-exists', res.dup); }
      await log('ok');
      await audit(ctx, { type: 'punch_in', staffId: me.id, staffName: me.name || '', date: z.date, to: z.hm, gps: gps ? 'captured' : gpsErr });
      if (st.mirrorToRegister) await mirrorMark(ctx.shopId, me.id, z.date, { m: 'P', i: z.hm, src: 's360' }).catch(() => {});
      return { ok: true, punch: publicPunch(res.p) };
    }

    // check-out: today's open punch, else yesterday's open punch (overnight), within 20h.
    let target = null;
    for (const date of [z.date, C.addDays(z.date, -1)]) {
      const snap = await db.doc(`staff360/${ctx.shopId}/punches/${me.id}_${date}`).get();
      if (snap.exists) {
        const p = snap.data();
        if (p.checkInAt && !p.checkOutAt && t - p.checkInAt < 20 * 3600 * 1000) { target = { date, p }; break; }
        if (date === z.date && p.checkOutAt) { await log('already_completed'); fail('already-exists', 'already_completed'); }
      }
    }
    if (!target) { await log('no_open_checkin'); fail('failed-precondition', 'no_open_checkin'); }
    const ref = db.doc(`staff360/${ctx.shopId}/punches/${me.id}_${target.date}`);
    const out = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const p = snap.data();
      if (p.checkOutAt) return { dup: true };
      const inMin = C.hmToMin(p.inHm);
      const worked = C.workedMinutes(p.checkInAt, t);
      const patch = {
        checkOutAt: t, outHm: z.hm, workedMinutes: worked,
        earlyLeaveMinutes: p.shiftSnapshot ? C.earlyLeaveMinutes(p.shiftSnapshot, p.checkInAt, t, inMin) : 0,
        checkOutGps: gpsDoc, checkOutGpsStatus: gps ? 'captured' : gpsErr, updatedAt: t, updatedBy: ctx.uid,
      };
      tx.update(ref, patch);
      return { p: Object.assign({}, p, patch) };
    });
    if (out.dup) { await log('already_completed', target.date); fail('already-exists', 'already_completed'); }
    await log('ok', target.date);
    await audit(ctx, { type: 'punch_out', staffId: me.id, staffName: me.name || '', date: target.date, to: z.hm, gps: gps ? 'captured' : gpsErr });
    if (st.mirrorToRegister) await mirrorMark(ctx.shopId, me.id, target.date, { o: z.hm, src: 's360' }).catch(() => {});
    // Auto half-day: short day, and nobody has marked this day by hand.
    if (st.autoHalfDay && out.p.workedMinutes < st.halfDayBelowHours * 60) {
      const ref2 = db.doc(markDocPath(ctx.shopId, me.id, target.date.slice(0, 7)));
      const cur = ((await ref2.get()).data() || {}).days || {};
      const m = cur[target.date] || {};
      if (!m.m || (m.m === 'P' && m.src === 's360')) {
        await mirrorMark(ctx.shopId, me.id, target.date, { m: 'H', src: 's360' }).catch(() => {});
        const w = out.p.workedMinutes;
        await audit(ctx, { type: 'auto_mark', staffId: me.id, staffName: me.name || '', date: target.date, from: m.m || '', to: 'H',
          reason: `Worked ${Math.floor(w / 60)}h ${w % 60}m, under ${st.halfDayBelowHours}h` });
      }
    }
    return { ok: true, punch: publicPunch(out.p) };
  }

  /* Employee's own history (last N days). */
  async function myHistory(data, auth) {
    const ctx = await caller(data, auth, { feature: 'self_checkin' });
    const me = await selfStaff(ctx);
    const st = await settings(ctx.shopId);
    const to = C.zoned(now(), st.timezone).date;
    const from = C.addDays(to, -Math.min(60, Math.max(7, Number(data.days) || 30)));
    const { marks, punches } = await loadRange(ctx.shopId, from, to, me.id);
    const agg = C.aggregate([{ id: me.id, name: me.name }], marks, punches, C.dateRange(from, to), { today: to });
    const reqs = await db.collection(`staff360/${ctx.shopId}/requests`).where('staffId', '==', me.id).get();
    return {
      from, to, row: agg.rows[0],
      requests: reqs.docs.map((d) => Object.assign({ id: d.id }, d.data())).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30),
    };
  }

  /* Basic+: trusted audit entry for a manual mark made through Step ATT. */
  async function logManualEdit(data, auth) {
    const ctx = await caller(data, auth, { roles: MANAGERS, feature: 'manual_attendance' });
    const list = Array.isArray(data.entries) ? data.entries.slice(0, 50) : [data];
    const ok = (m) => m === '' || ['P', 'H', 'A', 'L', 'W'].includes(m);
    let n = 0;
    let all = null;
    for (const e of list) {
      const date = str(e && e.date, 10);
      if (!C.isDate(date)) fail('invalid-argument', 'date');
      const from = str(e.from, 2), to = str(e.to, 2);
      if (!ok(from) || !ok(to)) fail('invalid-argument', 'status');
      const sid = str(e.staffId, 128);
      const who = (all || (all = await staffList(ctx.shopId))).find((s) => s.id === sid);
      if (!who) continue;
      await audit(ctx, { type: 'manual_mark', staffId: sid, staffName: who.name || '', date, from, to,
        reason: str(e.reason, 200), clientAt: Number(e.at) || null });
      n++;
    }
    return { ok: true, logged: n };
  }

  async function listAudit(data, auth) {
    const ctx = await caller(data, auth, { roles: MANAGERS, feature: 'audit_log' });
    const q = await db.collection(`staff360/${ctx.shopId}/audit`).orderBy('at', 'desc').limit(Math.min(200, Number(data.limit) || 100)).get();
    return { items: q.docs.map((d) => Object.assign({ id: d.id }, d.data())) };
  }

  /* Premium: register with punch evidence for one day. */
  async function register(data, auth) {
    const ctx = await caller(data, auth, { roles: MANAGERS, feature: 'daily_register' });
    const detailed = C.can(ctx.plan, 'history_detailed');
    const st = await settings(ctx.shopId);
    const date = C.isDate(data.date) ? data.date : C.zoned(now(), st.timezone).date;
    const { staff, marks, punches } = await loadRange(ctx.shopId, date, date);
    const sh = await shifts(ctx.shopId);
    const out = {
      date, timezone: st.timezone, detailed, today: C.zoned(now(), st.timezone).date,
      rows: staff.map((s) => {
        const p = (punches[s.id] || {})[date];
        const rec = C.dayRecord((marks[s.id] || {})[date], p);
        const shift = shiftFor(sh, s.id);
        return Object.assign({ staffId: s.id, name: s.name || 'Staff', role: s.role || '', shift: shift ? shift.name : null }, rec, {
          checkInGps: p && p.checkInGps ? p.checkInGps : null, checkOutGps: p && p.checkOutGps ? p.checkOutGps : null,
          checkInGpsStatus: p ? p.checkInGpsStatus || null : null, checkOutGpsStatus: p ? p.checkOutGpsStatus || null : null,
          weeklyOff: shift && Array.isArray(shift.weeklyOff) ? shift.weeklyOff.includes(C.weekdayOf(date)) : false,
        });
      }),
    };
    if (!detailed) {
      out.rows = out.rows.map((r) => ({ staffId: r.staffId, name: r.name, role: r.role, status: r.status, inHm: r.inHm, outHm: r.outHm, canLogin: false }));
    }
    return out;
  }

  /* Reports: Basic gets totals; Premium+ gets hours/late and rows to export. */
  async function report(data, auth) {
    const ctx = await caller(data, auth, { roles: MANAGERS, feature: 'report_basic' });
    const st = await settings(ctx.shopId);
    const today = C.zoned(now(), st.timezone).date;
    const from = str(data.from, 10), to = str(data.to, 10) > today ? today : str(data.to, 10);
    checkRange(from, to);
    const sid = data.staffId ? str(data.staffId, 128) : null;
    const { staff, marks, punches } = await loadRange(ctx.shopId, from, to, sid);
    const agg = C.aggregate(staff, marks, punches, C.dateRange(from, to), { today });
    const detailed = C.can(ctx.plan, 'report_detailed');
    const rows = agg.rows.map((r) => {
      const base = { staffId: r.staffId, name: r.name, P: r.P, H: r.H, A: r.A, L: r.L, W: r.W, unmarked: r.unmarked };
      return detailed ? Object.assign(base, { late: r.late, lateMin: r.lateMin, earlyLeaves: r.earlyLeaves, workedMin: r.workedMin, incomplete: r.incomplete, days: r.days }) : base;
    });
    const total = detailed ? agg.total : { P: agg.total.P, H: agg.total.H, A: agg.total.A, L: agg.total.L, W: agg.total.W, unmarked: agg.total.unmarked };
    return { from, to, detailed, exportAllowed: C.can(ctx.plan, 'report_export'), rows, total };
  }

  /* ───────────── Premium: shifts ───────────── */

  async function listShifts(data, auth) {
    const ctx = await caller(data, auth, { roles: MANAGERS, feature: 'shifts' });
    return { shifts: await shifts(ctx.shopId) };
  }

  async function saveShift(data, auth) {
    const ctx = await caller(data, auth, { roles: MANAGERS, feature: 'shifts' });
    const name = str(data.name, 40);
    if (!name) fail('invalid-argument', 'Shift name is required');
    if (C.hmToMin(data.start) == null || C.hmToMin(data.end) == null) fail('invalid-argument', 'Start and end must be HH:MM');
    if (data.start === data.end) fail('invalid-argument', 'Start and end cannot be the same');
    const graceMin = Math.max(0, Math.min(180, Math.round(Number(data.graceMin) || 0)));
    const weeklyOff = Array.isArray(data.weeklyOff) ? Array.from(new Set(data.weeklyOff.map(Number).filter((n) => n >= 0 && n <= 6))) : [];
    const all = await staffList(ctx.shopId);
    const valid = new Set(all.map((s) => s.id));
    const staffIds = Array.isArray(data.staffIds) ? data.staffIds.map((x) => str(x, 128)).filter((x) => valid.has(x)) : [];
    const id = data.id ? str(data.id, 64) : null;
    const coll = db.collection(`staff360/${ctx.shopId}/shifts`);
    const ref = id ? coll.doc(id) : coll.doc();
    const prev = id ? (await ref.get()).data() || null : null;
    if (id && !prev) fail('not-found', 'shift');
    const breakMin = Math.max(0, Math.min(240, Math.round(Number(data.breakMin) || 0)));
    const color = ['blue', 'purple', 'green', 'orange'].includes(data.color) ? data.color : 'green';
    const doc = { name, start: data.start, end: data.end, graceMin, breakMin, color, weeklyOff, staffIds, overnight: C.hmToMin(data.end) <= C.hmToMin(data.start), updatedAt: now(), updatedBy: ctx.uid };
    if (!prev) Object.assign(doc, { createdAt: now(), createdBy: ctx.uid });
    await ref.set(doc, { merge: true });
    // One shift per person: remove these staff from other shifts.
    if (staffIds.length) {
      for (const other of await shifts(ctx.shopId)) {
        if (other.id === ref.id || !Array.isArray(other.staffIds)) continue;
        const keep = other.staffIds.filter((s) => !staffIds.includes(s));
        if (keep.length !== other.staffIds.length) await coll.doc(other.id).set({ staffIds: keep, updatedAt: now() }, { merge: true });
      }
    }
    await audit(ctx, { type: prev ? 'shift_updated' : 'shift_created', shiftId: ref.id, to: `${name} ${data.start}-${data.end} grace ${graceMin}`, from: prev ? `${prev.name} ${prev.start}-${prev.end} grace ${prev.graceMin}` : '' });
    return { ok: true, id: ref.id };
  }

  async function deleteShift(data, auth) {
    const ctx = await caller(data, auth, { roles: MANAGERS, feature: 'shifts' });
    const ref = db.doc(`staff360/${ctx.shopId}/shifts/${str(data.id, 64)}`);
    const snap = await ref.get();
    if (!snap.exists) fail('not-found', 'shift');
    await ref.set({ deleted: true, staffIds: [], updatedAt: now(), updatedBy: ctx.uid }, { merge: true });
    await audit(ctx, { type: 'shift_deleted', shiftId: snap.id, from: snap.data().name });
    return { ok: true };
  }

  async function saveSettings(data, auth) {
    // Renaming the business is allowed on every plan; everything else needs Premium.
    const onlyName = Object.keys(data || {}).every((k) => k === 'shopId' || k === 'businessName');
    const ctx = await caller(data, auth, onlyName ? { roles: ['owner'] } : { roles: ['owner'], feature: 'settings' });
    const patch = {};
    if (data.timezone != null) { if (!C.validTz(data.timezone)) fail('invalid-argument', 'Unknown timezone'); patch.timezone = data.timezone; }
    if (data.gpsPolicy != null) patch.gpsPolicy = data.gpsPolicy === 'allow_without' ? 'allow_without' : 'require';
    if (data.minAccuracyM != null) patch.minAccuracyM = Math.min(5000, Math.max(10, Math.round(Number(data.minAccuracyM) || 150)));
    if (data.lateThreshold != null) patch.lateThreshold = Math.max(2, Math.min(15, Math.round(Number(data.lateThreshold) || 3)));
    if (data.mirrorToRegister != null) patch.mirrorToRegister = !!data.mirrorToRegister;
    const num = (v, lo, hi) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) fail('invalid-argument', 'Value out of range'); return n; };
    if (data.defaultGraceMin != null) patch.defaultGraceMin = Math.round(num(data.defaultGraceMin, 0, 180));
    if (data.hoursPerDay != null) patch.hoursPerDay = num(data.hoursPerDay, 1, 16);
    if (data.halfDayBelowHours != null) patch.halfDayBelowHours = num(data.halfDayBelowHours, 1, 12);
    if (data.autoLate != null) patch.autoLate = !!data.autoLate;
    if (data.autoHalfDay != null) patch.autoHalfDay = !!data.autoHalfDay;
    if (data.autoAbsent != null) patch.autoAbsent = !!data.autoAbsent;
    if (data.geofence) {
      const g = data.geofence, mode = ['off', 'flag', 'block'].includes(g.mode) ? g.mode : 'off';
      const lat = Number(g.lat), lng = Number(g.lng);
      if (mode !== 'off' && (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180)) fail('invalid-argument', 'Set the shop location first');
      patch.geofence = { mode, radiusM: Math.round(num(g.radiusM || 200, 50, 5000)),
        lat: Number.isFinite(lat) ? Math.round(lat * 1e6) / 1e6 : null, lng: Number.isFinite(lng) ? Math.round(lng * 1e6) / 1e6 : null };
    }
    const flags = (o, keys) => { const out = {}; keys.forEach((k) => { if (o && o[k] != null) out[k] = !!o[k]; }); return out; };
    if (data.perms) patch.perms = flags(data.perms, ['requestLeave', 'seeShift', 'managerEdit', 'managerSalary']);
    if (data.notify) patch.notify = flags(data.notify, ['dailySummary', 'lateAlert', 'leaveAlert']);
    if (data.businessName != null) {
      if (ctx.kind !== 'org') fail('failed-precondition', 'Rename your shop in the HisaabNow app.');
      const nm = str(data.businessName, 60);
      if (nm.length < 2) fail('invalid-argument', 'Enter the business name');
      await db.doc(tenantDocPath(ctx.shopId)).set({ name: nm, updatedAt: now() }, { merge: true });
    }
    patch.updatedAt = now(); patch.updatedBy = ctx.uid;
    await db.doc(`staff360/${ctx.shopId}`).set(patch, { merge: true });
    await audit(ctx, { type: 'settings_updated', to: JSON.stringify(Object.assign({}, patch, { updatedAt: undefined, updatedBy: undefined })) });
    return { ok: true, settings: await settings(ctx.shopId) };
  }

  /* ───────────── Premium: leave & correction requests ───────────── */

  async function submitRequest(data, auth) {
    const ctx = await caller(data, auth, { feature: 'leave_requests' });
    let me;
    if (data.staffId && MANAGERS.includes(ctx.role)) {
      me = (await staffList(ctx.shopId)).find((x) => x.id === str(data.staffId, 128));
      if (!me) fail('not-found', 'staff');
    } else me = await selfStaff(ctx);
    const type = data.type === 'correction' ? 'correction' : data.type === 'leave' ? 'leave' : null;
    if (!type) fail('invalid-argument', 'type must be leave or correction');
    const reason = str(data.reason, 300);
    if (reason.length < 3) fail('invalid-argument', 'Please add a reason');
    const st = await settings(ctx.shopId);
    const today = C.zoned(now(), st.timezone).date;
    const doc = { type, staffId: me.id, staffName: me.name || '', reason, status: 'pending', createdAt: now(), createdBy: ctx.uid };
    if (type === 'leave') {
      const from = str(data.fromDate, 10), to = str(data.toDate || data.fromDate, 10);
      checkRange(from, to);
      if (C.dateRange(from, to).length > 31) fail('invalid-argument', 'Leave is limited to 31 days per request');
      Object.assign(doc, { fromDate: from, toDate: to, leaveType: LEAVE_TYPES.includes(data.leaveType) ? data.leaveType : 'Other' });
      if (me.id !== (ctx.membership && ctx.membership.id)) doc.onBehalfOf = ctx.role;
    } else {
      const date = str(data.date, 10);
      if (!C.isDate(date) || date > today) fail('invalid-argument', 'Correction date must be today or earlier');
      const want = {};
      if (data.status) { if (!['P', 'H', 'A', 'L', 'W'].includes(data.status)) fail('invalid-argument', 'status'); want.status = data.status; }
      if (data.checkIn) { if (C.hmToMin(data.checkIn) == null) fail('invalid-argument', 'checkIn'); want.checkIn = data.checkIn; }
      if (data.checkOut) { if (C.hmToMin(data.checkOut) == null) fail('invalid-argument', 'checkOut'); want.checkOut = data.checkOut; }
      if (!Object.keys(want).length) fail('invalid-argument', 'Say what should be corrected');
      Object.assign(doc, { date, correction: want });
    }
    const ref = await db.collection(`staff360/${ctx.shopId}/requests`).add(doc);
    await audit(ctx, { type: 'request_created', requestId: ref.id, staffId: me.id, staffName: me.name || '', to: type, reason });
    return { ok: true, id: ref.id };
  }

  async function listRequests(data, auth) {
    const ctx = await caller(data, auth, { roles: MANAGERS, feature: 'leave_requests' });
    let q = db.collection(`staff360/${ctx.shopId}/requests`);
    if (['pending', 'approved', 'rejected'].includes(data.status)) q = q.where('status', '==', data.status);
    const snap = await q.get();
    return { items: snap.docs.map((d) => Object.assign({ id: d.id }, d.data())).sort((a, b) => b.createdAt - a.createdAt).slice(0, 200) };
  }

  async function decideRequest(data, auth) {
    const ctx = await caller(data, auth, { roles: MANAGERS, feature: 'leave_requests' });
    const decision = data.decision === 'approved' ? 'approved' : data.decision === 'rejected' ? 'rejected' : null;
    if (!decision) fail('invalid-argument', 'decision');
    const note = str(data.note, 300);
    if (decision === 'rejected' && note.length < 3) fail('invalid-argument', 'Add a reason for rejecting');
    const ref = db.doc(`staff360/${ctx.shopId}/requests/${str(data.id, 64)}`);
    const req = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) fail('not-found', 'request');
      const r = snap.data();
      if (r.status !== 'pending') fail('failed-precondition', 'Already decided');
      tx.update(ref, { status: decision, decidedBy: ctx.uid, decidedRole: ctx.role, decidedAt: now(), decisionNote: note });
      return Object.assign({ id: snap.id }, r);
    });
    if (decision === 'approved') {
      if (req.type === 'leave') {
        for (const d of C.dateRange(req.fromDate, req.toDate)) await mirrorMark(ctx.shopId, req.staffId, d, { m: 'L', src: 's360' });
      } else {
        const c = req.correction || {};
        const pref = db.doc(`staff360/${ctx.shopId}/punches/${req.staffId}_${req.date}`);
        const ps = await pref.get();
        if (ps.exists && (c.checkIn || c.checkOut)) {
          const p = ps.data();
          const patch = { corrected: true, correctionRequestId: req.id, updatedAt: now(), updatedBy: ctx.uid };
          if (c.checkIn) patch.inHm = c.checkIn;
          if (c.checkOut) patch.outHm = c.checkOut;
          const inM = C.hmToMin(patch.inHm || p.inHm), outM = C.hmToMin(patch.outHm || p.outHm);
          if (inM != null && outM != null) {
            patch.workedMinutes = outM > inM ? outM - inM : outM + 1440 - inM;
            if (p.shiftSnapshot) patch.lateMinutes = C.lateMinutes(p.shiftSnapshot, inM);
          }
          await pref.set(patch, { merge: true });
        }
        const m = {};
        if (c.status) m.m = c.status;
        if (c.checkIn) m.i = c.checkIn;
        if (c.checkOut) m.o = c.checkOut;
        await mirrorMark(ctx.shopId, req.staffId, req.date, Object.assign(m, { src: 's360' }));
      }
    }
    await audit(ctx, { type: 'request_' + decision, requestId: req.id, staffId: req.staffId, staffName: req.staffName,
      date: req.date || req.fromDate, from: 'pending', to: decision, reason: note });
    return { ok: true };
  }

  /* ───────────── King PRO: AI Staff Manager ───────────── */

  async function insightsFor(ctx, from, to, today) {
    const st = await settings(ctx.shopId);
    const { staff, marks, punches } = await loadRange(ctx.shopId, from, to);
    const agg = C.aggregate(staff, marks, punches, C.dateRange(from, to), { today });
    const period = { from, to };
    const log = await db.collection(`staff360/${ctx.shopId}/punchLog`)
      .where('attendanceDate', '>=', from).where('attendanceDate', '<=', to).get();
    const dupes = C.detectDuplicatePunches(log.docs.map((d) => d.data()).filter((e) => e.outcome !== 'ok' && /already/.test(e.outcome)), period);
    const list = C.detectAnomalies(agg, period, { lateThreshold: st.lateThreshold, today }).concat(dupes);
    const states = await db.collection(`staff360/${ctx.shopId}/insights`).get();
    const byId = {};
    states.docs.forEach((d) => { byId[d.id] = d.data(); });
    return { agg, staff, period, anomalies: list.map((a) => Object.assign(a, { review: byId[a.id] || null })) };
  }

  async function rateLimit(ctx) {
    const day = C.zoned(now(), C.DEFAULT_TZ).date.replace(/-/g, '');
    const ref = db.doc(`staff360/${ctx.shopId}/aiUsage/${day}`);
    const limit = Number(env.STAFF360_AI_DAILY_LIMIT) || AI_DAILY_LIMIT_DEFAULT;
    return db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const n = s.exists ? Number(s.data().count) || 0 : 0;
      if (n >= limit) fail('resource-exhausted', 'Daily AI question limit reached for this shop. Try again tomorrow.');
      tx.set(ref, { count: n + 1, updatedAt: now() }, { merge: true });
      return n + 1;
    });
  }

  async function aiDashboard(data, auth) {
    const ctx = await caller(data, auth, { roles: MANAGERS, feature: 'ai_dashboard' });
    const st = await settings(ctx.shopId);
    const today = C.zoned(now(), st.timezone).date;
    const from = C.addDays(today, -29);
    const ins = await insightsFor(ctx, from, today, today);
    const todayRows = ins.agg.rows.map((r) => r.days[r.days.length - 1]);
    const counts = { P: 0, H: 0, A: 0, L: 0, W: 0, late: 0, notMarked: 0 };
    todayRows.forEach((d) => { if (counts[d.status] != null) counts[d.status]++; else counts.notMarked++; if (d.lateMin > 0) counts.late++; });
    const open = ins.anomalies.filter((a) => !a.review || a.review.state === 'open');
    // Availability tomorrow from the last 8 weeks.
    const lbFrom = C.addDays(today, -56);
    const hist = await loadRange(ctx.shopId, lbFrom, today);
    const histAgg = C.aggregate(hist.staff, hist.marks, hist.punches, C.dateRange(lbFrom, today), { today });
    const avail = C.availabilityForecast(histAgg, C.addDays(today, 1), 8, 4);
    const salarySnap = await db.collection(`staff360/${ctx.shopId}/salary`).where('ym', '==', today.slice(0, 7)).get();
    const salaryDrafts = salarySnap.docs.map((d) => d.data());
    const facts = {
      today, period: { from, to: today }, staff: ins.staff.length, counts,
      patterns: open.map((a) => ({ type: a.type, staff: a.staffName, summary: a.summary })),
      availabilityTomorrow: avail.sufficient ? `${avail.expected} of ${avail.of} likely available` : 'not enough history',
    };
    let narrative = null;
    let narrativeSource = 'template';
    if (ai.configured()) {
      try {
        await rateLimit(ctx);
        const ps = C.pseudonymise(JSON.stringify(facts), ins.staff);
        const r = await ai.summarise(ps.text);
        if (r && r.text) { narrative = C.reidentify(r.text, ps.map); narrativeSource = 'ai'; }
        await logUsage(ctx, 'dashboard', r);
      } catch (e) { narrative = null; }
    }
    if (!narrative) {
      narrative = `Today: ${counts.P} present, ${counts.H} half-day, ${counts.A} absent, ${counts.L} on leave, ${counts.notMarked} not marked.` +
        (counts.late ? ` ${counts.late} late arrival(s).` : '') + (open.length ? ` ${open.length} pattern(s) to review in the last 30 days.` : ' No patterns to review in the last 30 days.');
    }
    return {
      today, counts, narrative, narrativeSource, anomalies: ins.anomalies, availability: avail,
      salary: { ym: today.slice(0, 7), drafts: salaryDrafts.length, approved: salaryDrafts.filter((d) => d.status === 'approved').length,
        totalGross: salaryDrafts.reduce((t, d) => t + (d.result ? d.result.gross : 0), 0) },
      ai: { configured: !!ai.configured() },
    };
  }

  async function logUsage(ctx, kind, r) {
    await db.collection(`staff360/${ctx.shopId}/aiUsageLog`).add({
      at: now(), kind, uid: ctx.uid, provider: (r && r.provider) || null,
      inputTokens: (r && r.usage && r.usage.input) || 0, outputTokens: (r && r.usage && r.usage.output) || 0,
    });
  }

  async function aiAsk(data, auth) {
    const ctx = await caller(data, auth, { roles: MANAGERS, feature: 'ai_assistant' });
    const q = str(data.question, 300);
    if (q.length < 3) fail('invalid-argument', 'Ask a question');
    const st = await settings(ctx.shopId);
    const today = C.zoned(now(), st.timezone).date;
    const staff = await staffList(ctx.shopId);
    const runFor = async (tool, args) => {
      if (tool === 'salary') {
        const s = await salaryList({ shopId: ctx.shopId, ym: today.slice(0, 7) }, auth);
        return { text: `Draft salary estimate for ${s.ym} (owner approval required): ₹${s.totalGross.toLocaleString('en-IN')} gross across ${s.rows.length} staff.`,
          items: s.rows.map((r) => ({ staffId: r.staffId, name: r.name, value: `₹${r.result.gross.toLocaleString('en-IN')}`, evidence: r.result.formula })),
          period: { from: today.slice(0, 7) + '-01', to: today, label: 'This month' } };
      }
      if (tool === 'availability') {
        const lbFrom = C.addDays(today, -56);
        const h = await loadRange(ctx.shopId, lbFrom, today);
        const av = C.availabilityForecast(C.aggregate(h.staff, h.marks, h.punches, C.dateRange(lbFrom, today), { today }), C.addDays(today, 1), 8, 4);
        return { text: av.sufficient ? `About ${av.expected} of ${av.of} staff are likely available tomorrow. ${av.limitation}` : `Not enough history to estimate tomorrow's availability. ${av.limitation}`,
          items: av.rows.map((r) => ({ staffId: r.staffId, name: r.name, value: r.likely == null ? `only ${r.samples} past days` : (r.likely ? 'likely' : 'unlikely'), evidence: [] })),
          period: { from: lbFrom, to: today, label: 'Last 8 weeks' } };
      }
      const p = C.periodRange(args.period || 'this_month', today);
      const period = Object.assign({}, p);
      const ins = await insightsFor(ctx, period.from, period.to, today);
      return C.runTool(tool, args, { agg: ins.agg, period, anomalies: ins.anomalies });
    };

    if (ai.configured()) {
      await rateLimit(ctx);
      try {
      const ps = C.pseudonymise(q, staff);
      const names = staff.map((s, i) => ({ id: s.id, token: `EMP${i + 1}` }));
      const r = await ai.answer(ps.text, names.map((n) => n.token), async (tool, args) => {
        if (args && args.employee) { const hit = names.find((n) => n.token === args.employee); args.staffId = hit ? hit.id : '__none__'; }
        const res = await runFor(tool, args || {});
        const p2 = C.pseudonymise(JSON.stringify({ text: res.text, items: res.items.map((i) => ({ name: i.name, value: i.value, evidence: i.evidence })) }), staff);
        return { forModel: p2.text, raw: res };
      });
      await logUsage(ctx, 'ask', r);
      if (r && r.text) {
        return { source: 'ai', text: C.reidentify(r.text, ps.map), results: r.toolResults || [], period: r.toolResults && r.toolResults[0] ? r.toolResults[0].period : null };
      }
      } catch (e) {
        // AI provider down or misconfigured: answer from the fixed rules below instead of failing.
        console.warn('[Staff360] AI answer failed, using rules', String(e && e.message || e).slice(0, 200));
      }
    }
    const route = C.routeQuestion(q, staff.map((s) => ({ id: s.id, name: s.name })));
    if (!route.tool) return { source: 'rules', text: C.runTool(null, {}, { agg: { rows: [] }, period: C.periodRange('today', today) }).text, results: [] };
    const res = await runFor(route.tool, route.args);
    return { source: 'rules', text: res.text, results: [res], period: res.period };
  }

  async function alertAction(data, auth) {
    const ctx = await caller(data, auth, { roles: MANAGERS, feature: 'ai_anomalies' });
    const id = str(data.id, 200);
    const state = data.state === 'reviewed' ? 'reviewed' : data.state === 'dismissed' ? 'dismissed' : data.state === 'open' ? 'open' : null;
    if (!id || !state) fail('invalid-argument', 'id/state');
    const reason = str(data.reason, 200);
    if (state === 'dismissed' && reason.length < 3) fail('invalid-argument', 'Add a reason for dismissing');
    await db.doc(`staff360/${ctx.shopId}/insights/${id.replace(/\//g, '_')}`).set({ state, reason, by: ctx.uid, at: now() }, { merge: true });
    await audit(ctx, { type: 'insight_' + state, insightId: id, reason });
    return { ok: true };
  }

  /* Salary: compute drafts for a month; owner can override inputs; approve. */
  async function salaryList(data, auth) {
    const ctx = await caller(data, auth, { roles: MANAGERS, feature: 'ai_salary' });
    const st = await settings(ctx.shopId);
    const today = C.zoned(now(), st.timezone).date;
    const ym = /^\d{4}-\d{2}$/.test(data.ym || '') ? data.ym : today.slice(0, 7);
    const from = ym + '-01';
    const last = ym + '-' + String(C.daysInMonth(ym)).padStart(2, '0');
    const to = last > today ? today : last;
    if (from > to) fail('invalid-argument', 'Month is in the future');
    const { staff, marks, punches } = await loadRange(ctx.shopId, from, to);
    const agg = C.aggregate(staff, marks, punches, C.dateRange(from, to), { today });
    const sh = await shifts(ctx.shopId);
    const drafts = {};
    (await db.collection(`staff360/${ctx.shopId}/salary`).where('ym', '==', ym).get()).docs.forEach((d) => { drafts[d.data().staffId] = d.data(); });
    const advSnap = ctx.kind === 'shop' ? await db.collection(`shops/${ctx.shopId}/expenses`).where('subcat', '==', 'staff_advance').get() : { docs: [] };
    const adv = {};
    advSnap.docs.forEach((d) => { const x = d.data(); if (!x._deleted && String(x.dateISO || '').slice(0, 7) === ym) adv[x.staffId] = (adv[x.staffId] || 0) + (Number(x.amt) || 0); });
    const cfgSnap = await Promise.all(staff.map((s) => (ctx.kind === 'shop' ? db.doc(`shops/${ctx.shopId}/agents/attcfg_${s.id}`).get() : Promise.resolve({ exists: false }))));
    const rows = agg.rows.map((r, i) => {
      const s = staff[i];
      const wage = cfgSnap[i].exists ? Number(cfgSnap[i].data().wage) || 0 : Number(s.dailyWage) || 0;
      const d = drafts[s.id] || {};
      const o = d.overrides || {};
      const input = {
        ym, basis: o.basis || (Number(s.salary) > 0 ? 'monthly' : 'daily'),
        monthlySalary: o.monthlySalary != null ? o.monthlySalary : Number(s.salary) || 0,
        dailyWage: o.dailyWage != null ? o.dailyWage : wage,
        divisor: o.divisor, leavePaid: o.leavePaid != null ? o.leavePaid : true,
        counts: { P: r.P, H: r.H, W: r.W, L: r.L },
        overtimeHours: o.overtimeHours != null ? o.overtimeHours : C.overtimeHours(r.days, shiftFor(sh, s.id)),
        overtimeRate: o.overtimeRate != null ? o.overtimeRate : 0,
        advance: adv[s.id] || 0,
      };
      return { staffId: s.id, name: s.name || 'Staff', status: d.status || 'draft', approvedAt: d.approvedAt || null,
        overrides: o, result: C.salaryEstimate(input), unmarked: r.unmarked, incomplete: r.incomplete };
    });
    return { ym, partialMonth: last > today, rows, totalGross: rows.reduce((t, r) => t + r.result.gross, 0) };
  }

  async function salarySave(data, auth) {
    const ctx = await caller(data, auth, { roles: MANAGERS, feature: 'ai_salary' });
    const ym = str(data.ym, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) fail('invalid-argument', 'ym');
    const sid = str(data.staffId, 128);
    if (!(await staffList(ctx.shopId)).some((s) => s.id === sid)) fail('not-found', 'staff');
    const ref = db.doc(`staff360/${ctx.shopId}/salary/${ym}_${sid}`);
    const prev = (await ref.get()).data() || {};
    if (data.approve) {
      if (ctx.role !== 'owner') fail('permission-denied', 'Only the owner can approve salary estimates');
      const list = await salaryList({ shopId: ctx.shopId, ym }, auth);
      const row = list.rows.find((r) => r.staffId === sid);
      await ref.set({ ym, staffId: sid, status: 'approved', approvedBy: ctx.uid, approvedAt: now(), result: row.result, overrides: prev.overrides || {} }, { merge: true });
      await audit(ctx, { type: 'salary_approved', staffId: sid, staffName: row.name, date: ym, to: `₹${row.result.gross}` });
      return { ok: true };
    }
    const o = data.overrides || {};
    const clean = {};
    if (o.basis === 'monthly' || o.basis === 'daily') clean.basis = o.basis;
    for (const k of ['monthlySalary', 'dailyWage', 'overtimeHours', 'overtimeRate', 'divisor']) {
      if (o[k] != null && o[k] !== '') { const n = Number(o[k]); if (!Number.isFinite(n) || n < 0 || n > 1e7) fail('invalid-argument', k); clean[k] = n; }
    }
    if (o.leavePaid != null) clean.leavePaid = !!o.leavePaid;
    await ref.set({ ym, staffId: sid, status: 'draft', overrides: clean, updatedAt: now(), updatedBy: ctx.uid, approvedAt: null, approvedBy: null }, { merge: true });
    await audit(ctx, { type: 'salary_inputs_edited', staffId: sid, date: ym, from: JSON.stringify(prev.overrides || {}), to: JSON.stringify(clean) });
    const list = await salaryList({ shopId: ctx.shopId, ym }, auth);
    const row = list.rows.find((r) => r.staffId === sid);
    await ref.set({ result: row.result }, { merge: true });
    return { ok: true, row };
  }

  /* ───────────── King PRO: WhatsApp reports ───────────── */

  async function whatsapp(data, auth) {
    const op = data.op || 'get';
    const ctx = await caller(data, auth, { roles: ['owner'], feature: 'whatsapp_reports' });
    const ref = db.doc(`staff360/${ctx.shopId}/whatsapp/settings`);
    const cur = (await ref.get()).data() || {};
    if (op === 'get') {
      const logs = await db.collection(`staff360/${ctx.shopId}/whatsappLog`).orderBy('at', 'desc').limit(20).get();
      return { settings: cur, providerConfigured: !!wa.configured(), log: logs.docs.map((d) => d.data()) };
    }
    if (op === 'preview') {
      const st = await settings(ctx.shopId);
      const today = C.zoned(now(), st.timezone).date;
      const { staff, marks, punches } = await loadRange(ctx.shopId, today, today);
      const agg = C.aggregate(staff, marks, punches, [today], { today });
      return { text: digestText(ctx.shop.name || 'Your shop', today, agg) };
    }
    if (op === 'disable') {
      await ref.set({ enabled: false, updatedAt: now(), updatedBy: ctx.uid }, { merge: true });
      await db.doc(`staff360WaSchedule/${ctx.shopId}`).set({ enabled: false }, { merge: true });
      await audit(ctx, { type: 'whatsapp_disabled' });
      return { ok: true };
    }
    if (op === 'save') {
      const recipient = str(data.recipient, 20).replace(/[^\d+]/g, '');
      if (!/^\+\d{10,15}$/.test(recipient)) fail('invalid-argument', 'Recipient must be a full number like +919876543210');
      const cadence = data.cadence === 'weekly' ? 'weekly' : 'daily';
      if (C.hmToMin(data.sendTime) == null) fail('invalid-argument', 'sendTime');
      if (data.consent !== true) fail('failed-precondition', 'Tick the consent box to receive reports');
      const st = await settings(ctx.shopId);
      const doc = { recipient, cadence, sendTime: data.sendTime, weekday: Number.isInteger(data.weekday) ? data.weekday % 7 : 1,
        optIn: true, consentAt: now(), consentBy: ctx.uid, enabled: true, timezone: st.timezone, updatedAt: now() };
      await ref.set(doc, { merge: true });
      await db.doc(`staff360WaSchedule/${ctx.shopId}`).set({ shopId: ctx.shopId, enabled: true, cadence, sendTime: doc.sendTime, weekday: doc.weekday, timezone: st.timezone, lastSentKey: cur.lastSentKey || null }, { merge: true });
      await audit(ctx, { type: 'whatsapp_optin', to: `${cadence} ${doc.sendTime}` });
      return { ok: true, providerConfigured: !!wa.configured(), note: wa.configured() ? '' : 'Saved. Nothing will be sent until the WhatsApp provider is configured.' };
    }
    fail('invalid-argument', 'op');
  }

  function digestText(shopName, date, agg) {
    const t = agg.total;
    const late = agg.rows.filter((r) => r.late > 0).map((r) => r.name);
    const abs = agg.rows.filter((r) => r.A > 0).map((r) => r.name);
    return [`Staff360 · ${shopName} · ${date}`,
      `Present ${t.P} · Half-day ${t.H} · Absent ${t.A} · Leave ${t.L} · Not marked ${t.unmarked}`,
      abs.length ? `Absent: ${abs.join(', ')}` : '', late.length ? `Late: ${late.join(', ')}` : '',
      `Hours logged: ${Math.floor(t.workedMin / 60)}h ${t.workedMin % 60}m`].filter(Boolean).join('\n');
  }

  /* Scheduled: send due digests. Never sends unless provider configured,
   * opted in, enabled and the shop is on King PRO right now. */
  async function runWhatsAppDigests() {
    if (!wa.configured()) return { sent: 0, reason: 'provider_not_configured' };
    const t = now();
    const q = await db.collection('staff360WaSchedule').where('enabled', '==', true).get();
    let sent = 0;
    for (const d of q.docs) {
      const s = d.data();
      const shopId = d.id;
      const ent = C.resolveEntitlement((await db.doc(`staff360Entitlements/${shopId}`).get()).data(), t);
      if (!C.can(ent.planId, 'whatsapp_reports')) continue;
      const z = C.zoned(t, s.timezone);
      const due = C.hmToMin(s.sendTime);
      if (due == null || z.minutes < due || z.minutes > due + 45) continue;
      if (s.cadence === 'weekly' && z.weekday !== s.weekday) continue;
      const key = `${z.date}`;
      if (s.lastSentKey === key) continue;
      const settingsDoc = (await db.doc(`staff360/${shopId}/whatsapp/settings`).get()).data() || {};
      if (!settingsDoc.optIn || !settingsDoc.enabled) continue;
      const shop = (await db.doc(tenantDocPath(shopId)).get()).data() || {};
      const from = s.cadence === 'weekly' ? C.addDays(z.date, -6) : z.date;
      const { staff, marks, punches } = await loadRange(shopId, from, z.date);
      const agg = C.aggregate(staff, marks, punches, C.dateRange(from, z.date), { today: z.date });
      const text = digestText(shop.name || 'Your shop', s.cadence === 'weekly' ? `${from} to ${z.date}` : z.date, agg);
      let result;
      try { result = await wa.send(settingsDoc.recipient, text); } catch (e) { result = { ok: false, error: String(e && e.message || e).slice(0, 200) }; }
      await db.collection(`staff360/${shopId}/whatsappLog`).add({ at: t, key, ok: !!result.ok, providerId: result.id || null, error: result.error || null });
      if (result.ok) { await d.ref.set({ lastSentKey: key }, { merge: true }); sent++; }
    }
    return { sent };
  }

  /* ───────────── Plans, billing, admin ───────────── */

  /* Older screens called this. Payment now goes through PayU (payuCreateOrder
   * with product 'staff360', which calls billingQuote below). */
  async function createOrder(data, auth) {
    await caller(data, auth, { roles: ['owner'] });
    return { ok: false, reason: 'use_payu' };
  }

  /* What an owner would pay to buy or renew a plan. Called by payuCreateOrder
   * on the server: the amount charged comes from here, never from the client. */
  async function billingQuote(data, auth) {
    const ctx = await caller(data, auth, { roles: ['owner'] });
    const planId = str(data.planId, 20);
    if (!['premium', 'kingpro'].includes(planId)) fail('invalid-argument', 'Unknown plan');
    const p = C.PLANS[planId];
    const cur = ctx.ent;
    if ((cur.status === 'active' || cur.status === 'grace') && C.rankOf(cur.planId) > C.rankOf(planId)) {
      fail('failed-precondition', `You're on ${C.PLANS[cur.planId].name}. You can switch to ${p.name} after it ends.`);
    }
    const doc = (await db.doc(`staff360Entitlements/${ctx.shopId}`).get()).data();
    const next = C.extendEntitlement(doc, planId, p.months, now());
    return { shopId: ctx.shopId, kind: ctx.kind, shopName: ctx.shop.name || '', planId, planName: p.name, amountInr: p.priceInr, months: p.months, endAt: next.endAt };
  }

  /* Admin path. Payments are applied by staff360/billing.js inside the PayU
   * webhook's transaction, using the same C.extendEntitlement. */
  async function activatePlan(shopId, planId, opts) {
    if (!PLANS_OK(planId) || planId === 'basic') throw new Error('bad plan');
    const t = now();
    const ref = db.doc(`staff360Entitlements/${shopId}`);
    const cur = (await ref.get()).data() || {};
    const next = C.extendEntitlement(cur, planId, (opts && opts.months) || C.PLANS[planId].months, t);
    await ref.set({ planId, status: 'active', startAt: next.startAt, endAt: next.endAt, graceUntil: next.graceUntil,
      provider: (opts && opts.provider) || 'manual', providerRef: (opts && opts.providerRef) || null,
      renewal: 'manual', updatedAt: t, updatedBy: (opts && opts.by) || 'system' }, { merge: true });
    return { ok: true, endAt: next.endAt };
  }
  const PLANS_OK = (p) => ['basic', 'premium', 'kingpro'].includes(p);

  async function adminSetPlan(data, auth) {
    if (!auth || !auth.uid) fail('unauthenticated', 'sign in');
    const admins = String(env.STAFF360_ADMIN_UIDS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!(auth.token && auth.token.admin === true) && !admins.includes(auth.uid)) fail('permission-denied', 'Admins only');
    const shopId = str(data.shopId, 128);
    if (!(await db.doc(tenantDocPath(shopId)).get()).exists) fail('not-found', 'business');
    if (data.planId === 'basic' || data.revoke) {
      await db.doc(`staff360Entitlements/${shopId}`).set({ status: 'cancelled', updatedAt: now(), updatedBy: auth.uid }, { merge: true });
      return { ok: true, plan: 'basic' };
    }
    if (!PLANS_OK(data.planId)) fail('invalid-argument', 'planId');
    return activatePlan(shopId, data.planId, { months: Math.max(1, Math.min(36, Number(data.months) || 12)), provider: 'admin', providerRef: str(data.ref, 100), by: auth.uid });
  }

  async function adminSetPlanConfig(data, auth) {
    if (!auth || !auth.uid) fail('unauthenticated', 'sign in');
    const admins = String(env.STAFF360_ADMIN_UIDS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!(auth.token && auth.token.admin === true) && !admins.includes(auth.uid)) fail('permission-denied', 'Admins only');
    const patch = {};
    for (const id of ['basic', 'premium', 'kingpro']) {
      const o = (data && data[id]) || null;
      if (!o) continue;
      patch[id] = {};
      // Prices are fixed in core.js (the PayU charge reads them there). Only staff limits are adjustable; 0 = no limit.
      if (o.maxStaff !== undefined) patch[id].maxStaff = o.maxStaff === null ? null : Math.max(0, Math.round(Number(o.maxStaff) || 0));
    }
    await db.doc('staff360Config/plans').set(patch, { merge: true });
    return { ok: true };
  }

  /* ═════════════ Standalone Staff360 (hisaabnow.com/staff360) ═════════════ */

  const normPhone = (v) => {
    const ph = str(v, 20).replace(/[^\d+]/g, '');
    if (/^\+\d{10,15}$/.test(ph)) return ph;
    if (/^\d{10}$/.test(ph)) return '+91' + ph;
    if (/^0\d{10}$/.test(ph)) return '+91' + ph.slice(1);
    return null;
  };

  async function indexPhone(phone, tenantId, entry) {
    if (!phone) return;
    const ref = db.doc(`staff360PhoneIndex/${phone}`);
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const t = (s.exists && s.data().tenants) || {};
      if (entry) t[tenantId] = entry; else delete t[tenantId];
      tx.set(ref, { tenants: t, updatedAt: now() });
    });
  }

  /* Every business this login can open: Staff360 orgs and HisaabNow shops it
   * owns, HisaabNow staff logins, and Staff360 roster logins. */
  async function myTenants(data, auth) {
    if (!auth || !auth.uid) fail('unauthenticated', 'Please sign in.');
    const phone = (auth.token && auth.token.phone_number) || null;
    const out = new Map();
    const add = (id, name, kind, role) => { if (!out.has(id)) out.set(id, { id, name: name || 'My business', kind, role }); };
    const [orgs, shops] = await Promise.all([
      db.collection('staff360Orgs').where('ownerId', '==', auth.uid).limit(10).get(),
      db.collection('shops').where('ownerId', '==', auth.uid).limit(10).get(),
    ]);
    orgs.docs.forEach((d) => add(d.id, d.data().name, 'org', 'owner'));
    shops.docs.forEach((d) => add(d.id, d.data().name, 'shop', 'owner'));
    if (phone) {
      const idx = (await db.doc(`staff360PhoneIndex/${phone}`).get()).data();
      const cand = Object.keys((idx && idx.tenants) || {});
      const hn = await db.collection(`staffPhoneIndex/${phone}/shops`).limit(10).get();
      hn.docs.forEach((d) => { const x = d.data() || {}; if (x.shopId && x.active !== false) cand.push(x.shopId); });
      for (const id of Array.from(new Set(cand)).slice(0, 15)) {
        if (out.has(id)) continue;
        try {
          const ctx = await caller({ shopId: id }, auth);
          add(id, ctx.shop.name, ctx.kind, ctx.role);
        } catch (e) { /* no longer a member — skip */ }
      }
    }
    return { tenants: Array.from(out.values()) };
  }

  async function createOrg(data, auth) {
    if (!auth || !auth.uid) fail('unauthenticated', 'Please sign in.');
    const name = str(data.name, 60);
    if (name.length < 2) fail('invalid-argument', 'Enter your business name');
    const existing = await db.collection('staff360Orgs').where('ownerId', '==', auth.uid).limit(5).get();
    if (existing.size >= 3) fail('resource-exhausted', 'You can create up to 3 businesses. Contact us for more.');
    const tz = C.validTz(data.timezone) ? data.timezone : C.DEFAULT_TZ;
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let id = 's360_';
    for (let i = 0; i < 16; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
    const t = now();
    await db.doc(`staff360Orgs/${id}`).set({ ownerId: auth.uid, ownerPhone: (auth.token && auth.token.phone_number) || null,
      name, businessType: str(data.businessType, 30) || 'other', createdAt: t, updatedAt: t });
    await db.doc(`staff360/${id}`).set({ timezone: tz, gpsPolicy: 'require', mirrorToRegister: true, createdAt: t }, { merge: true });
    return { ok: true, id };
  }

  /* Staff list for the Staff360 screens (with login flag). */
  async function staffRoster(data, auth) {
    const ctx = await caller(data, auth, { roles: MANAGERS, feature: 'staff_manage' });
    const list = await staffList(ctx.shopId);
    const all = await db.collection(`staff360/${ctx.shopId}/roster`).get();
    const inactive = all.docs.map((d) => Object.assign({ id: d.id }, d.data())).filter((x) => !x.removed && x.active === false);
    const cfg = C.mergePlanConfig(((await db.doc('staff360Config/plans').get()).data()) || {});
    return {
      kind: ctx.kind, editable: ctx.kind === 'org', maxStaff: cfg[ctx.plan].maxStaff,
      staff: list.concat(inactive).map((x) => ({ id: x.id, name: x.name || 'Staff', role: x.role || '', phone: x.phoneE164 || null,
        salary: Number(x.salary) || 0, dailyWage: Number(x.dailyWage) || 0, active: x.active !== false, canLogin: x.canLogin === true,
        hisaabnowLogin: !!(ctx.kind === 'shop' && String(x.id).startsWith('+')),
        joinedDate: x.joinedDate || null, empType: x.empType || null, empCode: x.empCode || null,
        weeklyOff: Number.isInteger(x.weeklyOff) ? x.weeklyOff : null })),
    };
  }

  /* Add / edit staff (orgs), or grant a Staff360 login (orgs and shops).
   * For HisaabNow shops the name/role/salary come from the app, so only the
   * phone and the login switch can be changed here. */
  async function staffSave(data, auth) {
    const ctx = await caller(data, auth, { roles: MANAGERS, feature: 'staff_manage' });
    const coll = db.collection(`staff360/${ctx.shopId}/roster`);
    let id = data.id ? str(data.id, 128) : null;
    if (id && (id.includes('/') || id.startsWith('+'))) fail('invalid-argument', 'This staff member is managed in the HisaabNow app.');
    const prev = id ? (await coll.doc(id).get()).data() || null : null;
    if (id && (!prev || prev.removed)) fail('not-found', 'staff');
    const phone = data.phone ? normPhone(data.phone) : (prev ? prev.phoneE164 || null : null);
    if (data.phone && !phone) fail('invalid-argument', 'Enter a 10-digit mobile number');
    const canLogin = data.canLogin === true;
    if (canLogin && !phone) fail('invalid-argument', 'A mobile number is needed for login');
    const patch = { phoneE164: phone, canLogin, updatedAt: now(), updatedBy: ctx.uid };
    // Staff360-only details (not part of the HisaabNow staff record), allowed for shops too.
    if (data.weeklyOff !== undefined) patch.weeklyOff = Number.isInteger(data.weeklyOff) && data.weeklyOff >= 0 && data.weeklyOff <= 6 ? data.weeklyOff : null;
    if (data.empType !== undefined) patch.empType = EMP_TYPES.includes(data.empType) ? data.empType : null;
    if (data.empCode !== undefined) {
      const code = str(data.empCode, 12).toUpperCase();
      if (code && !/^[A-Z0-9-]{2,12}$/.test(code)) fail('invalid-argument', 'Employee ID can use letters, numbers and -');
      if (code) {
        const dupe = await coll.where('empCode', '==', code).limit(3).get();
        if (dupe.docs.some((d) => d.id !== id && !d.data().removed)) fail('already-exists', 'This employee ID is already used');
      }
      patch.empCode = code || null;
    }
    if (data.joinedDate !== undefined && ctx.kind === 'shop') patch.joinedDate = C.isDate(data.joinedDate) ? data.joinedDate : null;
    if (ctx.kind === 'org') {
      const name = str(data.name, 80);
      if (name.length < 2) fail('invalid-argument', 'Enter the staff name');
      const role = str(data.role, 40) || 'Staff';
      if (/^manager$/i.test(role) && ctx.role !== 'owner') fail('permission-denied', 'Only the owner can add a manager');
      Object.assign(patch, { name, role, salary: Math.max(0, Math.min(1e7, Number(data.salary) || 0)),
        dailyWage: Math.max(0, Math.min(1e6, Number(data.dailyWage) || 0)), active: data.active !== false,
        joinedDate: C.isDate(data.joinedDate) ? data.joinedDate : (prev && prev.joinedDate) || null });
      if (!prev) {
        const cfg = C.mergePlanConfig(((await db.doc('staff360Config/plans').get()).data()) || {});
        const max = cfg[ctx.plan].maxStaff;
        if (max && (await staffList(ctx.shopId)).length >= max) fail('resource-exhausted', `Your plan allows ${max} staff. Upgrade to add more.`);
        Object.assign(patch, { removed: false, createdAt: now(), createdBy: ctx.uid });
      }
    } else {
      if (!prev) fail('failed-precondition', 'Add staff in the HisaabNow app first.');
      // HisaabNow shops: the app's staff list is free; the plan limit counts staff with a Staff360 phone login.
      if (canLogin && prev.canLogin !== true) {
        const cfg = C.mergePlanConfig(((await db.doc('staff360Config/plans').get()).data()) || {});
        const max = cfg[ctx.plan].maxStaff;
        const logins = (await staffList(ctx.shopId)).filter((x) => x.canLogin === true && x.active !== false).length;
        if (max && logins >= max) fail('resource-exhausted', `Your plan allows ${max} staff logins. Upgrade to add more.`);
      }
      if (/^manager$/i.test(prev.role || '') && canLogin && ctx.role !== 'owner') fail('permission-denied', 'Only the owner can give a manager login');
    }
    if (phone) {
      const clash = await coll.where('phoneE164', '==', phone).limit(3).get();
      if (clash.docs.some((d) => d.id !== id && !d.data().removed)) fail('already-exists', 'Another staff member already uses this number');
    }
    const ref = id ? coll.doc(id) : coll.doc();
    await ref.set(patch, { merge: true });
    id = ref.id;
    if (prev && prev.phoneE164 && prev.phoneE164 !== phone) await indexPhone(prev.phoneE164, ctx.shopId, null);
    await indexPhone(phone, ctx.shopId, canLogin && patch.active !== false ? { name: ctx.shop.name || '', staffId: id } : null);
    await audit(ctx, { type: prev ? 'staff_updated' : 'staff_created', staffId: id, staffName: patch.name || (prev && prev.name) || '',
      to: `${canLogin ? 'login on' : 'login off'}${patch.active === false ? ', inactive' : ''}` });
    return { ok: true, id };
  }

  async function staffRemove(data, auth) {
    const ctx = await caller(data, auth, { roles: ['owner'], feature: 'staff_manage' });
    if (ctx.kind !== 'org') fail('failed-precondition', 'Remove staff in the HisaabNow app.');
    const ref = db.doc(`staff360/${ctx.shopId}/roster/${str(data.id, 128)}`);
    const prev = (await ref.get()).data();
    if (!prev || prev.removed) fail('not-found', 'staff');
    await ref.set({ removed: true, canLogin: false, updatedAt: now(), updatedBy: ctx.uid }, { merge: true });
    await indexPhone(prev.phoneE164, ctx.shopId, null);
    await audit(ctx, { type: 'staff_removed', staffId: ref.id, staffName: prev.name || '' });
    return { ok: true };
  }

  /* Auto-absent: staff who check in on their phone, were expected (not a weekly
   * off, not on approved leave) and have no mark or check-in for the day. */
  async function autoAbsentFor(shopId, date, actor) {
    const [staff, sh, reqs] = await Promise.all([staffList(shopId), shifts(shopId),
      db.collection(`staff360/${shopId}/requests`).where('status', '==', 'approved').get()]);
    const leave = reqs.docs.map((d) => d.data()).filter((r) => r.type === 'leave' && r.fromDate <= date && (r.toDate || r.fromDate) >= date);
    const wd = C.weekdayOf(date), done = [];
    for (const s of staff) {
      // Staff360 login: expected to check in. A HisaabNow app login (cashier etc.) counts only
      // if they have actually used Staff360 check-in in the last 14 days; otherwise people who
      // only bill in the app would be marked absent every night.
      let checksIn = s.canLogin === true;
      if (!checksIn && String(s.id).startsWith('+')) {
        const days = Array.from({ length: 14 }, (_, i) => C.addDays(date, -1 - i));
        const ps = await Promise.all(days.map((d) => db.doc(`staff360/${shopId}/punches/${s.id}_${d}`).get()));
        checksIn = ps.some((x) => x.exists && x.data() && x.data().checkInAt);
      }
      if (!checksIn) continue;
      const shift = shiftFor(sh, s.id);
      const off = Number.isInteger(s.weeklyOff) ? s.weeklyOff === wd : !!(shift && Array.isArray(shift.weeklyOff) && shift.weeklyOff.includes(wd));
      if (off || leave.some((r) => r.staffId === s.id)) continue;
      const m = (((await db.doc(markDocPath(shopId, s.id, date.slice(0, 7))).get()).data() || {}).days || {})[date] || {};
      const p = (await db.doc(`staff360/${shopId}/punches/${s.id}_${date}`).get()).data();
      if (m.m || m.i || (p && p.checkInAt)) continue;
      await mirrorMark(shopId, s.id, date, { m: 'A', src: 'auto' });
      await db.collection(`staff360/${shopId}/audit`).add({ at: now(), actorUid: actor ? actor.uid : 'system', actorRole: actor ? actor.role : 'system',
        type: 'auto_mark', staffId: s.id, staffName: s.name || '', date, from: '', to: 'A', reason: 'No check-in or mark for the day' });
      done.push(s.id);
    }
    return done;
  }
  async function autoAbsent(data, auth) {
    const ctx = await caller(data, auth, { roles: MANAGERS, feature: 'self_checkin' });
    const st = await settings(ctx.shopId);
    const today = C.zoned(now(), st.timezone).date;
    const date = C.isDate(data.date) ? data.date : today;
    if (date > today || date < C.addDays(today, -31)) fail('invalid-argument', 'Pick today or a date in the last 31 days');
    const marked = await autoAbsentFor(ctx.shopId, date, ctx);
    return { ok: true, date, marked: marked.length };
  }
  /* Scheduled: end of day in each business's timezone (after 23:00). */
  async function runAutoAbsent() {
    const q = await db.collection('staff360').where('autoAbsent', '==', true).get();
    let n = 0;
    for (const d of q.docs) {
      const shopId = d.id, s = d.data();
      const ent = C.resolveEntitlement((await db.doc(`staff360Entitlements/${shopId}`).get()).data(), now());
      if (!C.can(ent.planId, 'self_checkin')) continue;
      const z = C.zoned(now(), C.validTz(s.timezone) ? s.timezone : C.DEFAULT_TZ);
      if (z.minutes < 23 * 60 || s.lastAutoAbsent === z.date) continue;
      n += (await autoAbsentFor(shopId, z.date, null)).length;
      await db.doc(`staff360/${shopId}`).set({ lastAutoAbsent: z.date }, { merge: true });
    }
    return { marked: n };
  }

  /* Per-day records for the Staff360 screens (dashboard, register, calendar,
   * reports). Basic: marks only. Premium+: punch evidence (late, hours, GPS). */
  async function records(data, auth) {
    const ctx = await caller(data, auth, { roles: MANAGERS, feature: 'daily_register' });
    const st = await settings(ctx.shopId);
    const today = C.zoned(now(), st.timezone).date;
    const to = C.isDate(data.to) && data.to < today ? data.to : today;
    const from = C.isDate(data.from) ? data.from : C.addDays(to, -30);
    checkRange(from, to);
    const detailed = C.can(ctx.plan, 'history_detailed');
    const { staff, marks, punches } = await loadRange(ctx.shopId, from, to);
    const dates = C.dateRange(from, to);
    const rows = staff.map((s) => ({
      staffId: s.id,
      days: dates.map((d) => {
        const p = (punches[s.id] || {})[d];
        const rec = C.dayRecord((marks[s.id] || {})[d], p);
        if (!rec.status && !rec.inHm) return null;
        const out = { date: d, status: rec.status, inHm: rec.inHm, outHm: rec.outHm };
        if (detailed && p) Object.assign(out, { lateMin: rec.lateMin, workedMin: rec.workedMin, incomplete: rec.incomplete,
          gps: p.checkInGps ? { accuracy: p.checkInGps.accuracy, low: !!p.checkInGps.lowAccuracy, distanceM: p.checkInGps.distanceM, outside: !!p.checkInGps.outside } : (p.checkInGpsStatus ? false : null) });
        return out;
      }).filter(Boolean),
    }));
    return { from, to, today, timezone: st.timezone, detailed, rows };
  }

  /* Manual attendance marking done on the server: the previous value is read
   * here, so the audit trail cannot be faked by the device. */
  async function mark(data, auth) {
    const ctx = await caller(data, auth, { roles: MANAGERS, feature: 'manual_attendance' });
    const list = Array.isArray(data.entries) ? data.entries.slice(0, 60) : [];
    if (!list.length) fail('invalid-argument', 'Nothing to mark');
    const st = await settings(ctx.shopId);
    const today = C.zoned(now(), st.timezone).date;
    const oldest = C.addDays(today, -62);
    const staff = await staffList(ctx.shopId);
    const reason = str(data.reason, 200);
    const done = [];
    for (const e of list) {
      const date = str(e && e.date, 10), sid = str(e && e.staffId, 128), m = str(e && e.status, 2);
      if (!C.isDate(date) || date > today || date < oldest) fail('invalid-argument', 'Date must be within the last 62 days');
      if (!(m === '' || ['P', 'H', 'A', 'L', 'W'].includes(m))) fail('invalid-argument', 'status');
      const who = staff.find((x) => x.id === sid);
      if (!who) continue;
      const ref = db.doc(markDocPath(ctx.shopId, sid, date.slice(0, 7)));
      const prevMark = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const cur = snap.exists ? (snap.data().days || {})[date] || {} : {};
        const next = Object.assign({}, cur);
        if (m) next.m = m; else delete next.m;
        if (e.in !== undefined) { if (e.in && C.hmToMin(e.in) == null) fail('invalid-argument', 'in'); if (e.in) next.i = e.in; else delete next.i; }
        if (e.out !== undefined) { if (e.out && C.hmToMin(e.out) == null) fail('invalid-argument', 'out'); if (e.out) next.o = e.out; else delete next.o; }
        next.src = 's360';
        const empty = !next.m && !next.i && !next.o;
        if (snap.exists) tx.update(ref, { [`days.${date}`]: empty ? null : next, _lastUpdated: now() });
        else if (!empty) tx.set(ref, { id: ref.id, kind: 'hn_att', staffId: sid, ym: date.slice(0, 7), days: { [date]: next }, _lastUpdated: now() });
        return cur.m || '';
      });
      if (prevMark !== m) await audit(ctx, { type: 'manual_mark', staffId: sid, staffName: who.name || '', date, from: prevMark, to: m, reason, server: true });
      done.push(sid);
    }
    return { ok: true, marked: done.length };
  }

  return {
    getState, punch, myHistory, syncRoster, logManualEdit,
    myTenants, createOrg, staffRoster, staffSave, staffRemove, mark, records, autoAbsent, runAutoAbsent, listAudit, register, report,
    listShifts, saveShift, deleteShift, saveSettings,
    submitRequest, listRequests, decideRequest,
    aiDashboard, aiAsk, alertAction, salaryList, salarySave,
    whatsapp, runWhatsAppDigests, createOrder, billingQuote, activatePlan, adminSetPlan, adminSetPlanConfig,
    _digestText: digestText,
  };
}

module.exports = { createHandlers };
