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
const { defineSecret } = require('firebase-functions/params');

/* AI: the same OpenAI key HisaabNow already uses (Firebase secret OPENAI_API_KEY).
 * Only the functions that need it get it. Provider and model can be changed with
 * STAFF360_AI_PROVIDER / STAFF360_AI_MODEL in functions/.env. */
const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
if (!process.env.STAFF360_AI_PROVIDER) process.env.STAFF360_AI_PROVIDER = 'openai';
if (!process.env.STAFF360_AI_MODEL) process.env.STAFF360_AI_MODEL = 'gpt-5.6-terra';

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
      billing: createBilling(env, null), // payments: see billing.js (called from functions/payu.js)
    });
  }
  return H;
}

const call = (name) => onCall(OPTS, (req) => handlers()[name](req.data || {}, req.auth || null));
const callAI = (name) => onCall(Object.assign({ secrets: [OPENAI_API_KEY] }, OPTS), (req) => handlers()[name](req.data || {}, req.auth || null));

/* (Nov 2026) Speed: every Staff360 screen now calls ONE function, staff360Api, with
 * { __op: '<old function name>', ...data }. One function stays warm for all buttons
 * (35 separate functions were each cold on their first click: several seconds each).
 * No instance is kept always ready by default (that costs ~$4.50/month; set
 * STAFF360_MIN_INSTANCES=1 in functions/.env to turn it on). Full CPU keeps cold starts short.
 * The old per-button functions stay for older copies of the app. */
const API_OPS = {
  staff360GetState: 'getState', staff360Punch: 'punch', staff360MyHistory: 'myHistory', staff360SyncRoster: 'syncRoster',
  staff360MyTenants: 'myTenants', staff360CreateOrg: 'createOrg', staff360StaffRoster: 'staffRoster', staff360StaffSave: 'staffSave',
  staff360StaffRemove: 'staffRemove', staff360Mark: 'mark', staff360Records: 'records', staff360AutoAbsent: 'autoAbsent',
  staff360LogManualEdit: 'logManualEdit', staff360ListAudit: 'listAudit', staff360Register: 'register', staff360Report: 'report',
  staff360ListShifts: 'listShifts', staff360SaveShift: 'saveShift', staff360DeleteShift: 'deleteShift', staff360SaveSettings: 'saveSettings',
  staff360SubmitRequest: 'submitRequest', staff360ListRequests: 'listRequests', staff360DecideRequest: 'decideRequest',
  staff360AIDashboard: 'aiDashboard', staff360AIAsk: 'aiAsk', staff360AlertAction: 'alertAction', staff360SalaryList: 'salaryList',
  staff360SalarySave: 'salarySave', staff360WhatsApp: 'whatsapp', staff360CreateOrder: 'createOrder',
  staff360AdminSetPlan: 'adminSetPlan', staff360AdminSetPlanConfig: 'adminSetPlanConfig',
};
const MIN_INSTANCES = Number.isInteger(+process.env.STAFF360_MIN_INSTANCES) && process.env.STAFF360_MIN_INSTANCES !== '' ? +process.env.STAFF360_MIN_INSTANCES : 0;
const API_OPTS = Object.assign({ secrets: [OPENAI_API_KEY], memory: '512MiB', cpu: 1, concurrency: 40, minInstances: MIN_INSTANCES, timeoutSeconds: 60 }, OPTS);
async function api(req) {
  const data = Object.assign({}, req.data || {});
  const op = String(data.__op || '');
  delete data.__op;
  if (!Object.prototype.hasOwnProperty.call(API_OPS, op)) throw new HttpsError('invalid-argument', 'Unknown Staff360 action');
  return handlers()[API_OPS[op]](data, req.auth || null);
}

module.exports = {
  staff360Api: onCall(API_OPTS, api),
  staff360GetState: callAI('getState'),
  staff360Punch: call('punch'),
  staff360MyHistory: call('myHistory'),
  staff360SyncRoster: call('syncRoster'),
  staff360MyTenants: call('myTenants'),
  staff360CreateOrg: call('createOrg'),
  staff360StaffRoster: call('staffRoster'),
  staff360StaffSave: call('staffSave'),
  staff360StaffRemove: call('staffRemove'),
  staff360Mark: call('mark'),
  staff360Records: call('records'),
  staff360AutoAbsent: call('autoAbsent'),
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
  staff360AIDashboard: callAI('aiDashboard'),
  staff360AIAsk: callAI('aiAsk'),
  staff360AlertAction: call('alertAction'),
  staff360SalaryList: call('salaryList'),
  staff360SalarySave: call('salarySave'),
  staff360WhatsApp: call('whatsapp'),
  staff360CreateOrder: call('createOrder'),
  staff360AdminSetPlan: call('adminSetPlan'),
  staff360AdminSetPlanConfig: call('adminSetPlanConfig'),
  staff360WhatsAppDigest: onSchedule({ region: REGION, schedule: 'every 30 minutes', timeZone: 'Asia/Kolkata' },
    () => handlers().runWhatsAppDigests()),
  staff360AutoAbsentDaily: onSchedule({ region: REGION, schedule: 'every 60 minutes', timeZone: 'Asia/Kolkata' },
    () => handlers().runAutoAbsent()),
};
