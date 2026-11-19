const DELAY = {}; // /__delay?fn=staff360SyncRoster&ms=7000 simulates a cold server
/* QA server: serves the repo + a harness page, and runs the REAL Staff360
 * handlers against the in-memory Firestore so the UI is tested end-to-end.
 *   node functions-staff360/qa/server.js  →  http://127.0.0.1:8360/qa
 * Harness controls: /__plan?p=basic|premium|kingpro, /__reset */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createFake } = require('../test/fakeFirestore');
const { createHandlers } = require('../staff360/handlers');

const ROOT = path.resolve(__dirname, '../..');
const PORT = Number(process.env.PORT || 8360);
class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

const USERS = {
  owner: { uid: 'ownerA', token: { phone_number: '+919000000001' } },
  manager: { uid: 'mgrA', token: { phone_number: '+919222222222' } },
  employee: { uid: 'empA', token: { phone_number: '+919111111111' } },
  newowner: { uid: 'newOwner', token: { phone_number: '+919800000001' } },
  orgemp: { uid: 'orgEmp', token: { phone_number: '+919800000002' } },
  admin: { uid: 'platformAdmin', token: {} },
};
let db, h;
function today(off) { const d = new Date(Date.now() + 5.5 * 3600e3 + (off || 0) * 864e5); return d.toISOString().slice(0, 10); }
function reset() {
  db = createFake();
  h = createHandlers({ db, HttpsError, env: { STAFF360_ADMIN_UIDS: 'platformAdmin' } });
  db._seed('shops/A', { ownerId: 'ownerA', name: 'Glow Salon' });
  const staff = [['amit', 'Amit Kumar', 'Cashier', '+919111111111', 18000], ['riya', 'Riya Sharma', 'Stylist', '+919444444444', 15000],
    ['meena', 'Meena Joshi', 'Manager', '+919222222222', 25000], ['vikas', 'Vikas Singh', 'Helper', '+919555555555', 12000]];
  for (const [id, name, role, ph, sal] of staff) db._seed(`staff360/A/roster/${id}`, { name, role, phoneE164: ph, salary: sal });
  db._seed('shops/A/staff/+919111111111', { name: 'Amit Kumar', role: 'cashier', active: true });
  db._seed('shops/A/staff/+919222222222', { name: 'Meena Joshi', role: 'manager', active: true });
  db._seed('staffPhoneIndex/+919222222222/shops/A', { shopId: 'A', active: true });
  db._seed('staffPhoneIndex/+919111111111/shops/A', { shopId: 'A', active: true });
  // 20 days of sample (DEMO) history: Amit often late, Riya absent on Mondays.
  for (let i = 1; i <= 20; i++) {
    const d = today(-i);
    const wd = new Date(d + 'T00:00:00Z').getUTCDay();
    const late = i % 3 === 0;
    db._seed(`staff360/A/punches/amit_${d}`, { staffId: 'amit', staffName: 'Amit Kumar', attendanceDate: d, checkInAt: 1, checkOutAt: i === 2 ? null : 2,
      inHm: late ? '09:32' : '09:04', outHm: i === 2 ? '' : '18:05', lateMinutes: late ? 32 : 0, workedMinutes: i === 2 ? 0 : 540,
      checkInGps: { lat: 28.5355, lng: 77.391, accuracy: 18, capturedAt: 1 }, checkInGpsStatus: 'captured', shiftSnapshot: { start: '09:00', end: '18:00', graceMin: 10 } });
    const ym = d.slice(0, 7);
    const put = (sid, m) => { const k = `shops/A/agents/att_${sid}_${ym}`; const cur = db._store.get(k) || { kind: 'hn_att', staffId: sid, ym, days: {} }; cur.days[d] = { m }; db._store.set(k, cur); };
    put('riya', wd === 1 ? 'A' : 'P'); put('meena', 'P'); put('vikas', wd === 0 ? 'W' : 'P');
  }
}
reset();

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__reset') {
    for (const k of Object.keys(DELAY)) delete DELAY[k]; reset(); res.end('ok'); return; }
  if (url.pathname === '/__delay') { DELAY[url.searchParams.get('fn')] = +url.searchParams.get('ms') || 0; res.end('ok'); return; }
  if (url.pathname === '/__plan') {
    const p = url.searchParams.get('p');
    const shop = url.searchParams.get('shop') || 'A';
    await h.adminSetPlan({ shopId: shop, planId: p, months: 12 }, USERS.admin);
    if (shop !== 'A') { res.end('ok'); return; }
    if (p === 'premium' || p === 'kingpro') await h.saveShift({ shopId: 'A', name: 'Morning', start: '09:00', end: '18:00', graceMin: 10, weeklyOff: [0], staffIds: ['amit', 'riya'] }, USERS.owner).catch(() => {});
    res.end('ok'); return;
  }
  /* Stand-in for PayU: the checkout form posts here; we "pay" and send the browser back
     the way payuReturn does. The real PayU path is tested in test/payu.test.js. */
  if (url.pathname === '/__payu') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const f = new URLSearchParams(body), ok = f.get('qa_outcome') !== 'failed';
      if (ok) await h.activatePlan(f.get('shopId'), f.get('planId'), { months: +f.get('months'), provider: 'payu', providerRef: f.get('txnid') });
      const back = f.get('back'), at = back.indexOf('#');
      res.statusCode = 303;
      res.setHeader('location', back.slice(0, at) + (back.indexOf('?') >= 0 && back.indexOf('?') < at ? '&' : '?') + 'payu=' + (ok ? 'success' : 'failed') + '&txnid=' + f.get('txnid') + back.slice(at));
      res.end();
    });
    return;
  }
  if (url.pathname === '/__call/payuCreateOrder') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      res.setHeader('content-type', 'application/json');
      try {
        const d = JSON.parse(body || '{}');
        if (d.product !== 'staff360') throw Object.assign(new Error('only staff360 in QA'), { code: 'invalid-argument' });
        const q = await h.billingQuote({ shopId: d.shopId, planId: d.tier }, USERS[req.headers['x-user'] || 'owner']);
        const back = d.from === 'app' ? `/staff360/v2/app.html?t=${q.shopId}&n=${encodeURIComponent(q.shopName)}#/plans` : `/staff360/app/?t=${q.shopId}#/plans`;
        res.end(JSON.stringify({ data: { paymentUrl: '/__payu', params: { txnid: 'QA' + Date.now(), shopId: q.shopId, planId: q.planId, months: q.months, amount: q.amountInr.toFixed(2), back } } }));
      } catch (e) { res.end(JSON.stringify({ error: { code: e.code || 'internal', message: e.message } })); }
    });
    return;
  }
  if (url.pathname.startsWith('/__call/')) {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const fn = url.pathname.slice(8);
      const map = { staff360GetState: 'getState', staff360Punch: 'punch', staff360MyHistory: 'myHistory', staff360SyncRoster: 'syncRoster', staff360MyTenants: 'myTenants', staff360CreateOrg: 'createOrg', staff360StaffRoster: 'staffRoster', staff360StaffSave: 'staffSave', staff360StaffRemove: 'staffRemove', staff360Mark: 'mark', staff360Records: 'records', staff360AutoAbsent: 'autoAbsent', staff360AdminSetPlan: 'adminSetPlan', staff360LogManualEdit: 'logManualEdit', staff360ListAudit: 'listAudit',
        staff360Register: 'register', staff360Report: 'report', staff360ListShifts: 'listShifts', staff360SaveShift: 'saveShift', staff360DeleteShift: 'deleteShift',
        staff360SaveSettings: 'saveSettings', staff360SubmitRequest: 'submitRequest', staff360ListRequests: 'listRequests', staff360DecideRequest: 'decideRequest',
        staff360AIDashboard: 'aiDashboard', staff360AIAsk: 'aiAsk', staff360AlertAction: 'alertAction', staff360SalaryList: 'salaryList', staff360SalarySave: 'salarySave',
        staff360WhatsApp: 'whatsapp', staff360CreateOrder: 'createOrder' };
      res.setHeader('content-type', 'application/json');
      if (DELAY[fn]) await new Promise((r) => setTimeout(r, DELAY[fn]));
      if (!map[fn]) { res.end(JSON.stringify({ error: { code: 'not-found', message: 'NOT_FOUND' } })); return; }
      try {
        const out = await h[map[fn]](JSON.parse(body || '{}'), USERS[req.headers['x-user'] || 'owner']);
        res.end(JSON.stringify({ data: out }));
      } catch (e) { res.end(JSON.stringify({ error: { code: e.code || 'internal', message: e.message } })); }
    });
    return;
  }
  if (url.pathname === '/qa') {
    const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const start = idx.indexOf('HisaabNow Step ATT · Staff attendance');
    const s0 = idx.indexOf('<script>', start), s1 = idx.indexOf('</script>', s0) + 9;
    const html = fs.readFileSync(path.join(__dirname, 'harness.html'), 'utf8').replace('<!--STEP_ATT-->', idx.slice(s0, s1));
    res.setHeader('content-type', 'text/html'); res.end(html); return;
  }
  const p = url.pathname;
  const SITE = process.env.SITE_ROOT;
  const useSite = SITE && (/^\/staff360\/(app|login)\//.test(p) || p === '/hn-analytics.js' || p.startsWith('/legal/'));
  let file = path.join(useSite ? SITE : ROOT, decodeURIComponent(p));
  if (useSite && p.endsWith('/')) file = path.join(file, 'index.html');
  if (url.pathname.startsWith('/__fb/')) { file = path.join(__dirname, 'mock-firebase', path.basename(url.pathname)); }
  if (!(file.startsWith(ROOT) || (SITE && file.startsWith(SITE))) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end('nf'); return; }
  res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log('QA server on http://127.0.0.1:' + PORT + '/qa'));
