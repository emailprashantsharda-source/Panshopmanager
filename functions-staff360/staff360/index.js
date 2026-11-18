/* Staff360 Cloud Functions entry.
 *
 * Add to your existing functions/index.js (C:\dev\hisaabnow\functions):
 *     Object.assign(exports, require('./staff360'));
 * after copying this folder to functions/staff360/.
 * Requires firebase-functions >= 4.3 (v2 API) and firebase-admin (already used).
 */
'use strict';
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const { createHandlers } = require('./handlers');
const { createAI } = require('./ai');
const { createWhatsApp, createBilling } = require('./providers');

if (!admin.apps.length) admin.initializeApp();

const REGION = process.env.STAFF360_REGION || 'us-central1';
const OPTS = { region: REGION, enforceAppCheck: process.env.STAFF360_ENFORCE_APPCHECK !== 'false' };

let H = null;
function handlers() {
  if (!H) {
    const env = process.env;
    H = createHandlers({
      db: admin.firestore(), HttpsError, env,
      ai: createAI(env), wa: createWhatsApp(env),
      billing: createBilling(env, null /* plug your PayU order creator here */),
    });
  }
  return H;
}

const call = (name) => onCall(OPTS, (req) => handlers()[name](req.data || {}, req.auth || null));

module.exports = {
  staff360GetState: call('getState'),
  staff360Punch: call('punch'),
  staff360MyHistory: call('myHistory'),
  staff360SyncRoster: call('syncRoster'),
  staff360MyTenants: call('myTenants'),
  staff360CreateOrg: call('createOrg'),
  staff360StaffRoster: call('staffRoster'),
  staff360StaffSave: call('staffSave'),
  staff360StaffRemove: call('staffRemove'),
  staff360Mark: call('mark'),
  staff360LogManualEdit: call('logManualEdit'),
  staff360ListAudit: call('listAudit'),
  staff360Register: call('register'),
  staff360Report: call('report'),
  staff360ListShifts: call('listShifts'),
  staff360SaveShift: call('saveShift'),
  staff360DeleteShift: call('deleteShift'),
  staff360SaveSettings: call('saveSettings'),
  staff360SubmitRequest: call('submitRequest'),
  staff360ListRequests: call('listRequests'),
  staff360DecideRequest: call('decideRequest'),
  staff360AIDashboard: call('aiDashboard'),
  staff360AIAsk: call('aiAsk'),
  staff360AlertAction: call('alertAction'),
  staff360SalaryList: call('salaryList'),
  staff360SalarySave: call('salarySave'),
  staff360WhatsApp: call('whatsapp'),
  staff360CreateOrder: call('createOrder'),
  staff360AdminSetPlan: call('adminSetPlan'),
  staff360AdminSetPlanConfig: call('adminSetPlanConfig'),
  staff360WhatsAppDigest: onSchedule({ region: REGION, schedule: 'every 30 minutes', timeZone: 'Asia/Kolkata' },
    () => handlers().runWhatsAppDigests()),
};
