'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HisaabNow · PayU Hosted Checkout backend  (PayU-only, website pricing)
 * Firebase Functions v2 · us-central1
 *
 * Exports (wire these in index.js):
 *   payuCreateOrder  (onCall)    — client asks to subscribe; returns form+hash
 *   payuWebhook      (onRequest) — PayU server-to-server confirmation (truth)
 *   payuReturn       (onRequest) — surl/furl target; verifies, redirects to app
 *
 * PRODUCTS: HisaabNow (default), RentalNow (product 'rentalnow'),
 *           Staff360 (product 'staff360' — plans, prices and the write to
 *           staff360Entitlements live in ./staff360/billing.js + core.js).
 *
 * It does NOT export getSubscription — your existing one already reads the doc
 * this writes, so PayU subs "just work" in the app + admin dashboard.
 *
 * WRITES THE SAME SCHEMA AS adminActivatePro:
 *   users/{uid}/private/subscription  { plan, planName, expiry(Timestamp), ... }
 *   Renewals STACK on existing future expiry (same as adminActivatePro).
 *
 * SECURITY (do not weaken):
 *   - Salt in Firebase Secrets, never client / never logged.
 *   - Amount computed here from PAYU_PLANS, never trusted from client.
 *   - Webhook + return are the only writers of paid state; idempotent on txnid.
 *
 * PER-PROJECT CONFIG:
 *   Secrets:  PAYU_KEY, PAYU_SALT
 *   .env.<project>:
 *     PAYU_PAYMENT_URL  staging=https://test.payu.in/_payment
 *                       prod   =https://secure.payu.in/_payment
 *     PAYU_RETURN_URL   the deployed payuReturn URL
 *     APP_ORIGIN        https://app.hisaabnow.com   (staging.hisaabnow.com on staging)
 * ═══════════════════════════════════════════════════════════════════════════
 */

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');

const PAYU_KEY  = defineSecret('PAYU_KEY');
const PAYU_SALT = defineSecret('PAYU_SALT');

const PAYU_PAYMENT_URL = process.env.PAYU_PAYMENT_URL || 'https://test.payu.in/_payment';
const PAYU_RETURN_URL  = process.env.PAYU_RETURN_URL  || '';
const APP_ORIGIN       = process.env.APP_ORIGIN       || 'https://app.hisaabnow.com';
const REGION = 'us-central1';

/* ─── PayU sellable plans · WEBSITE PRICING IS SOURCE OF TRUTH ───
   The client sends {tier, cycle}; it NEVER sends an amount.
   Website "King" maps to your existing internal `business_*` plan keys so
   existing subscribers, getSubscription, and admin tools stay consistent. */
const PAYU_PLANS = {
  pro_monthly:      { amount: 499,  days: 30,  planName: 'Pro Monthly'  },
  pro_annual:       { amount: 4990, days: 365, planName: 'Pro Annual'   },
  business_monthly: { amount: 799,  days: 30,  planName: 'King Monthly' },
  business_annual:  { amount: 7990, days: 365, planName: 'King Annual'  },
};

/* ─── RentalNow plans ────────────────────────────────────────────────────
   A SEPARATE product with a separate table and a separate write target.

   Sharing PAYU_PLANS would have been quicker and wrong: the webhook below
   writes HisaabNow's subscription document, so a rental shop paying for
   RentalNow would have been granted HisaabNow Pro and nothing in the app
   they actually bought. Keeping the tables apart makes that impossible
   rather than merely unlikely.

   Priced by fleet size — a 15-bike shop and a 150-bike operator get very
   different value from identical software. Annual is ten months for twelve.
   No grandfathering: this product is new, so there is no old price to
   protect. Promo codes ARE supported — see payuCreateOrder below. They are
   evaluated against promo.js's rentalnow price table, which is separate
   from HisaabNow's for the same reason this table is. */
const RN_PLANS = {
  rn_starter_monthly: { amount: 499,   days: 30,  planName: 'RentalNow Starter Monthly' },
  rn_starter_annual:  { amount: 4990,  days: 365, planName: 'RentalNow Starter Annual'  },
  rn_growth_monthly:  { amount: 1299,  days: 30,  planName: 'RentalNow Growth Monthly'  },
  rn_growth_annual:   { amount: 12990, days: 365, planName: 'RentalNow Growth Annual'   },
  rn_pro_monthly:     { amount: 2499,  days: 30,  planName: 'RentalNow Pro Monthly'     },
  rn_pro_annual:      { amount: 24990, days: 365, planName: 'RentalNow Pro Annual'      },
  rn_multi_monthly:   { amount: 4999,  days: 30,  planName: 'RentalNow Multi Monthly'   },
  rn_multi_annual:    { amount: 49990, days: 365, planName: 'RentalNow Multi Annual'    },
};
function rnPlanKeyFor(tier, cycle) {
  const t = String(tier || '').toLowerCase();
  const c = String(cycle || '').toLowerCase();
  const cyc = (c === 'annual' || c === 'yearly' || c === 'y') ? 'annual' : 'monthly';
  const key = 'rn_' + t + '_' + cyc;
  return RN_PLANS[key] ? key : null;
}

/* GRANDFATHERING RETIRED (Jul 2026, price move to ₹499 / ₹799).
   ---------------------------------------------------------------------
   There used to be a second table here (PAYU_PLANS_GRANDFATHERED) plus an
   isGrandfathered(uid) Firestore read that decided which of the two to
   charge from. It has been deleted rather than emptied: two price tables
   that must agree is exactly the failure this codebase keeps rediscovering,
   and an empty-but-present table is an invitation to refill it.

   PAYU_PLANS above is now the only server-side price table for HisaabNow,
   and it must stay in step with App._pricing() in the app's index.html and
   with the hisaabnow| rows of PRICES in promo.js. Change one, change all
   three in the same commit.

   Existing subscribers therefore renew at list price. Already-created
   payuOrders documents are unaffected: the webhook verifies the amount PayU
   reports against the amount stored ON THE ORDER, not against this table,
   so in-flight checkouts started before this deploy still settle correctly. */

/* (tier, cycle) from the client  →  internal plan key */
function planKeyFor(tier, cycle) {
  if (tier === 'pro'  && cycle === 'monthly') return 'pro_monthly';
  if (tier === 'pro'  && cycle === 'annual')  return 'pro_annual';
  if (tier === 'king' && cycle === 'monthly') return 'business_monthly';
  if (tier === 'king' && cycle === 'annual')  return 'business_annual';
  return null;
}

function db() {
  if (!admin.apps.length) admin.initializeApp();
  return admin.firestore();
}
function sha512(s) {
  return crypto.createHash('sha512').update(s, 'utf8').digest('hex').toLowerCase();
}
function clean(s) {                         // '|' is the hash delimiter — strip it
  return String(s == null ? '' : s).replace(/\|/g, ' ').trim();
}
function makeTxnid() {
  return 'HN' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

/* Request hash:
   sha512(key|txnid|amount|productinfo|firstname|email|udf1..udf5||||||SALT) */
function buildRequestHash({ key, txnid, amount, productinfo, firstname, email, salt }) {
  const parts = [
    key, txnid, amount, productinfo, firstname, email,
    '', '', '', '', '',   // udf1..udf5
    '', '', '', '', '',   // reserved
    salt,
  ];
  return sha512(parts.join('|'));
}

/* Reverse hash (response):
   sha512([additionalCharges|]SALT|status||||||udf5..udf1|email|firstname|productinfo|amount|txnid|key) */
function buildResponseHash(body, salt) {
  const udf = (i) => body['udf' + i] || '';
  const parts = [
    salt, body.status || '',
    udf(10), udf(9), udf(8), udf(7), udf(6),
    udf(5), udf(4), udf(3), udf(2), udf(1),
    body.email || '', body.firstname || '', body.productinfo || '',
    body.amount || '', body.txnid || '', body.key || '',
  ];
  let str = parts.join('|');
  if (body.additionalCharges) str = body.additionalCharges + '|' + str;
  return sha512(str);
}
function hashesMatch(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); }
  catch (_) { return false; }
}

/* ════════════════════════════════════════════════════════════════════════
 * 1) payuCreateOrder — callable. Returns PayU Hosted Checkout form params.
 * ════════════════════════════════════════════════════════════════════════ */
const payuCreateOrder = onCall(
  { region: REGION, secrets: [PAYU_KEY, PAYU_SALT], enforceAppCheck: true },
  async (req) => {
    const uid = req.auth && req.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

    const tier  = String(req.data && req.data.tier  || '').toLowerCase();
    const cycle = String(req.data && req.data.cycle || '').toLowerCase();
    const product = String(req.data && req.data.product || 'hisaabnow').toLowerCase();

    /* ── Staff360: separate plans, separate write target ───────────────
       Same reasoning as RentalNow below: a Staff360 payment must never
       touch users/{uid}/private/subscription. The price, the owner check
       and the return address all come from staff360/billing.js on the
       server; the client sends only shopId, plan and where it opened from. */
    if (product === 'staff360') {
      const s360 = require('./staff360/billing');
      const q = await s360.quote({
        shopId: String(req.data && req.data.shopId || '').trim(),
        planId: tier,
        from: String(req.data && req.data.from || ''),
      }, req.auth);                               // throws HttpsError (role, plan) itself

      const sAmount = Number(q.amountInr).toFixed(2);
      let sPhone = '', sEmail = '', sFirst = 'Merchant';
      try {
        const u = await admin.auth().getUser(uid);
        sPhone = (u.phoneNumber || '').replace(/[^\d]/g, '').slice(-10);
        sEmail = u.email || (uid + '@user.hisaabnow.app');
        sFirst = clean(u.displayName || q.shopName || 'Merchant') || 'Merchant';
      } catch (_) { sEmail = uid + '@user.hisaabnow.app'; }

      const sKey  = PAYU_KEY.value();
      const sSalt = PAYU_SALT.value();
      const sTxn  = makeTxnid();
      const sInfo = clean(q.productinfo);
      const sHash = buildRequestHash({ key: sKey, txnid: sTxn, amount: sAmount,
                      productinfo: sInfo, firstname: sFirst, email: sEmail, salt: sSalt });

      await db().collection('payuOrders').doc(sTxn).set({
        uid, product: 'staff360', shopId: q.shopId, planKey: q.planId, months: q.months,
        amount: sAmount, returnUrl: q.returnUrl, promoCode: null, status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        paymentUrl: PAYU_PAYMENT_URL,
        params: {
          key: sKey, txnid: sTxn, amount: sAmount, productinfo: sInfo,
          firstname: sFirst, email: sEmail, phone: sPhone,
          surl: PAYU_RETURN_URL, furl: PAYU_RETURN_URL, hash: sHash,
        },
      };
    }

    /* ── RentalNow: separate plans, separate write target ─────────────
       Everything below the HisaabNow path is untouched; this returns
       early so the existing flow cannot be affected by a rental order. */
    if (product === 'rentalnow') {
      const shopId = String(req.data && req.data.shopId || '').trim();
      if (!shopId) throw new HttpsError('invalid-argument', 'No business specified.');

      const rnKey = rnPlanKeyFor(tier, cycle);
      if (!rnKey) throw new HttpsError('invalid-argument', 'Unknown plan.');
      const rnCfg = RN_PLANS[rnKey];

      /* Only someone who owns or manages the shop may buy for it — otherwise
         anyone holding a shop id could extend a stranger's subscription, or
         more usefully to an attacker, discover that it exists. */
      const shopSnap = await db().collection('rn_shops').doc(shopId).get();
      if (!shopSnap.exists) throw new HttpsError('not-found', 'Business not found.');
      const shop = shopSnap.data() || {};
      if (shop.ownerUid !== uid) {
        const mem = await db().collection('rn_shops').doc(shopId)
                      .collection('members').doc(uid).get();
        const role = mem.exists ? (mem.data() || {}).role : null;
        if (role !== 'owner' && role !== 'manager') {
          throw new HttpsError('permission-denied', 'Not allowed to pay for this business.');
        }
      }

      /* ── promo codes ────────────────────────────────────────────────
         Priced server-side from evaluatePromo, never from anything the
         client sends. The client only ever hands over a string.

         Note the FOUR-argument call. promo.js keys its price table
         product|tier|cycle because both products have a tier called 'pro'
         at wildly different prices — HisaabNow Pro annual ₹4,990 against
         RentalNow's ₹24,990. The legacy three-argument form still works
         and still means HisaabNow, which is why the path below this one
         needed no change. Calling it with three arguments from here would
         quietly price a rental order off HisaabNow's table. */
      let rnAmtNum = rnCfg.amount;
      let rnPromo = null;
      if (req.data && req.data.promoCode) {
        try {
          const ev = await require('./promo')
            .evaluatePromo('rentalnow', tier, cycle, req.data.promoCode);
          if (ev && ev.valid) { rnAmtNum = ev.finalPrice; rnPromo = ev.code; }
        } catch (e) { console.warn('[PayU] rn promo eval failed', e); }
      }
      const rnAmount = rnAmtNum.toFixed(2);
      let rnPhone = '', rnEmail = '', rnFirst = 'Merchant';
      try {
        const u = await admin.auth().getUser(uid);
        rnPhone = (u.phoneNumber || '').replace(/[^\d]/g, '').slice(-10);
        rnEmail = u.email || (uid + '@user.hisaabnow.app');
        rnFirst = clean(u.displayName || shop.name || 'Merchant') || 'Merchant';
      } catch (_) { rnEmail = uid + '@user.hisaabnow.app'; }

      const rnKeyId = PAYU_KEY.value();
      const rnSalt  = PAYU_SALT.value();
      const rnTxn   = makeTxnid();
      const rnInfo  = clean(rnCfg.planName);
      const rnHash  = buildRequestHash({ key: rnKeyId, txnid: rnTxn, amount: rnAmount,
                        productinfo: rnInfo, firstname: rnFirst, email: rnEmail, salt: rnSalt });

      /* ── auto-renew (PayU Standing Instruction) ──────────────────────
         Opt-in, monthly only. An annual plan renewing silently a year
         later is a charge nobody remembers agreeing to, and the whole
         reason this exists is the monthly shop that has to be chased by
         WhatsApp every thirty days.

         si / si_details / api_version ride ALONGSIDE the ordinary payment
         parameters — this is still a real first payment, it just also
         registers a mandate. The request hash is unchanged by them: PayU
         hashes key|txnid|amount|productinfo|firstname|email|udf1..5, and
         none of the SI fields appear in it.

         paymentEndDate is set ten years out rather than left open. A
         mandate with no end is one more thing that outlives the business
         relationship, and ten years is longer than any of this will last.
         The shop can cancel from inside the app at any time. */
      const rnAutopay = !!(req.data && req.data.autopay) && rnCfg.days <= 31;
      let rnSi = null;
      if (rnAutopay) {
        const d0 = new Date();
        const d1 = new Date(d0.getTime()); d1.setFullYear(d1.getFullYear() + 10);
        const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0')
                         + '-' + String(d.getDate()).padStart(2,'0');
        rnSi = {
          si: '1',
          api_version: '7',
          si_details: JSON.stringify({
            billingAmount: rnAmount,
            billingCurrency: 'INR',
            billingCycle: 'MONTHLY',
            billingInterval: 1,
            paymentStartDate: ymd(d0),
            paymentEndDate: ymd(d1),
            remarks: clean(rnCfg.planName) + ' auto-renew',
          }),
        };
      }

      await db().collection('payuOrders').doc(rnTxn).set({
        uid, product: 'rentalnow', shopId, planKey: rnKey, amount: rnAmount,
        /* Read by the webhook: a success on an order carrying this flag is
           what registers the mandate on the shop. Without it a successful
           SI payment would be indistinguishable from a one-off. */
        autopaySetup: rnAutopay,
        /* The webhook's redemption step reads order.promoCode and does not
           care which product it belongs to, so recording it here is the
           whole wiring. It only increments usedCount on a verified success
           and only once per txnid — an abandoned checkout costs a code
           nothing, which matters when maxRedemptions is 50 and half your
           traffic bounces at the bank page. */
        promoCode: rnPromo,
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        paymentUrl: PAYU_PAYMENT_URL,
        autopay: rnAutopay,
        params: Object.assign({
          key: rnKeyId, txnid: rnTxn, amount: rnAmount, productinfo: rnInfo,
          firstname: rnFirst, email: rnEmail, phone: rnPhone,
          surl: PAYU_RETURN_URL, furl: PAYU_RETURN_URL, hash: rnHash,
        }, rnSi || {}),
      };
    }

    const planKey = planKeyFor(tier, cycle);
    if (!planKey) throw new HttpsError('invalid-argument', 'Unknown plan.');

    /* One price for everyone — see the note where the grandfathered table
       used to live. */
    const cfg = PAYU_PLANS[planKey];
    let amtNum = cfg.amount;
    let appliedPromo = null;
    /* Promo codes now apply to every caller. The old `!grandfathered` guard
       existed to stop a promo RAISING the price for someone holding a cheaper
       legacy rate; with a single table there is no cheaper rate to protect. */
    if (req.data && req.data.promoCode) {
      try {
        const ev = await require('./promo').evaluatePromo(tier, cycle, req.data.promoCode);
        if (ev && ev.valid) { amtNum = ev.finalPrice; appliedPromo = ev.code; }
      } catch (e) { console.warn('[PayU] promo eval failed', e); }
    }
    const amount = amtNum.toFixed(2);   // hash + form must use the SAME string

    let phone = '', email = '', firstname = 'Merchant';
    try {
      const u = await admin.auth().getUser(uid);
      phone = (u.phoneNumber || '').replace(/[^\d]/g, '').slice(-10);
      email = u.email || (uid + '@user.hisaabnow.app');
      firstname = clean(u.displayName || 'Merchant') || 'Merchant';
    } catch (_) {
      email = uid + '@user.hisaabnow.app';
    }

    const key = PAYU_KEY.value();
    const salt = PAYU_SALT.value();
    const txnid = makeTxnid();
    const productinfo = clean('HisaabNow ' + cfg.planName);
    const hash = buildRequestHash({ key, txnid, amount, productinfo, firstname, email, salt });

    await db().collection('payuOrders').doc(txnid).set({
      uid, planKey, amount,
      /* Always false now. The field is kept so admin views and any query that
         reads it keep working against the historical orders that have it. */
      grandfathered: false,
      promoCode: appliedPromo,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      paymentUrl: PAYU_PAYMENT_URL,
      params: {
        key, txnid, amount, productinfo, firstname, email, phone,
        surl: PAYU_RETURN_URL, furl: PAYU_RETURN_URL,
        hash,
      },
    };
  }
);

/* ════════════════════════════════════════════════════════════════════════
 * RentalNow activation. Same guarantees as the HisaabNow path — idempotent
 * on txnid, stacks on any unexpired subscription so an early renewal never
 * costs the shop days it already paid for — but writes subscriptionExpiry on
 * the shop document, which is what the rules and the app actually read.
 * ════════════════════════════════════════════════════════════════════════ */
async function processRentalPayment(body, order, orderRef, cfg, txnid, status) {
  const shopRef = db().collection('rn_shops').doc(order.shopId);

  await db().runTransaction(async (tx) => {
    const freshOrder = await tx.get(orderRef);
    if ((freshOrder.data() || {}).status === 'success') return;   // already done

    if (status === 'success') {
      const shopSnap = await tx.get(shopRef);
      let base = new Date();
      if (shopSnap.exists) {
        const ex = (shopSnap.data() || {}).subscriptionExpiry;
        const exDate = ex && ex.toDate ? ex.toDate() : (ex ? new Date(ex) : null);
        if (exDate && exDate > base) base = exDate;               // stack
      }
      const newExpiry = new Date(base);
      newExpiry.setDate(newExpiry.getDate() + cfg.days);

      const shopPatch = {
        plan: order.planKey,
        planName: cfg.planName,
        subscriptionExpiry: admin.firestore.Timestamp.fromDate(newExpiry),
        paymentMode: 'payu',
        activatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastTxnid: txnid,
        lastPaymentId: body.mihpayid || null,
        amount: order.amount,
      };

      /* ── mandate registration ────────────────────────────────────────
         PayU reports a registered standing instruction by returning
         payment_source 'sist'; 'payu' on an SI attempt means the mandate
         did NOT register even though the payment itself went through. The
         distinction matters: recording a mandate that does not exist would
         leave the shop believing it is on auto-renew and then silently
         lapsing, which is worse than never offering it.

         mihpayid of THIS transaction is the authpayuid every later debit
         quotes, so it is stored as the mandate's identity, not merely as a
         receipt. */
      if (order.autopaySetup) {
        const registered = String(body.payment_source || '').toLowerCase() === 'sist';
        if (registered && body.mihpayid) {
          shopPatch.rnAutopay = {
            status: 'active',
            authpayuid: String(body.mihpayid),
            planKey: order.planKey,
            amount: order.amount,
            days: cfg.days,
            mode: body.mode || null,
            cardToken: body.cardToken || body.card_token || null,
            registeredAt: admin.firestore.Timestamp.fromDate(new Date()),
            nextDebitAt: admin.firestore.Timestamp.fromDate(newExpiry),
            seq: 1,
            pendingDebit: null,
            lastError: null,
          };
        } else {
          /* Payment kept, mandate not. The shop is paid up for this cycle
             and simply is not enrolled — say so rather than fail the
             payment. */
          shopPatch.rnAutopay = {
            status: 'not_registered',
            reason: String(body.payment_source || 'unknown'),
            attemptedAt: admin.firestore.Timestamp.fromDate(new Date()),
          };
        }
      }

      tx.set(shopRef, shopPatch, { merge: true });

      tx.update(orderRef, {
        status: 'success',
        mihpayid: body.mihpayid || null,
        mode: body.mode || null,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      /* Tagged so RentalNow revenue is separable from HisaabNow in the
         admin timeline rather than silently inflating it. */
      tx.set(db().collection('adminLogs').doc(), {
        action: 'activate_pro',
        product: 'rentalnow',
        uid: order.uid,
        shopId: order.shopId,
        plan: order.planKey,
        planName: cfg.planName,
        amount: Number(order.amount) || 0,
        paymentMode: 'payu',
        txnid,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      tx.update(orderRef, {
        status: 'failed',
        failReason: body.error_Message || body.field9 || body.status || 'failed',
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });

  return { ok: status === 'success', txnid, uid: order.uid, shopId: order.shopId,
           product: 'rentalnow' };
}

/* ════════════════════════════════════════════════════════════════════════
 * Shared verify + idempotent write (mirrors adminActivatePro schema + stacking).
 * ════════════════════════════════════════════════════════════════════════ */
async function processPayuResponse(body, salt) {
  const txnid = body.txnid;
  if (!txnid) return { ok: false, reason: 'no_txnid' };

  if (!hashesMatch(buildResponseHash(body, salt), body.hash)) {
    console.warn('[PayU] hash mismatch for txnid', txnid);
    return { ok: false, reason: 'bad_hash', txnid };
  }

  const orderRef = db().collection('payuOrders').doc(txnid);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) return { ok: false, reason: 'unknown_order', txnid };
  const order = orderSnap.data();

  /* Staff360 checks the amount against the order and writes its own
     entitlement, idempotently on txnid. */
  if (order.product === 'staff360') {
    return require('./staff360/billing').applyPayment({
      db: db(), body, order, orderRef, txnid, status: String(body.status || '').toLowerCase(),
    });
  }

  const isRental = order.product === 'rentalnow';
  const cfg = isRental ? RN_PLANS[order.planKey] : PAYU_PLANS[order.planKey];
  if (!cfg) return { ok: false, reason: 'unknown_plan', txnid, uid: order.uid };

  if (Math.abs(parseFloat(body.amount) - parseFloat(order.amount)) > 0.01) {
    console.warn('[PayU] amount mismatch', txnid, body.amount, order.amount);
    return { ok: false, reason: 'amount_mismatch', txnid, uid: order.uid };
  }

  const status = String(body.status || '').toLowerCase();

  /* A RentalNow payment buys time on the SHOP, not on the user: staff come
     and go, and the subscription has to outlive whoever happened to pay. */
  if (isRental) return processRentalPayment(body, order, orderRef, cfg, txnid, status);

  const subRef = db().collection('users').doc(order.uid)
                   .collection('private').doc('subscription');

  await db().runTransaction(async (tx) => {
    const freshOrder = await tx.get(orderRef);
    if ((freshOrder.data() || {}).status === 'success') return;   // already done

    if (status === 'success') {
      const existingSub = await tx.get(subRef);
      let base = new Date();
      if (existingSub.exists) {
        const ex = existingSub.data().expiry;
        const exDate = ex && ex.toDate ? ex.toDate() : null;
        if (exDate && exDate > base) base = exDate;               // stack on future expiry
      }
      const newExpiry = new Date(base);
      newExpiry.setDate(newExpiry.getDate() + cfg.days);

      tx.set(subRef, {
        plan: order.planKey,
        planName: cfg.planName,
        expiry: admin.firestore.Timestamp.fromDate(newExpiry),
        paymentMode: 'payu',
        activatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastTxnid: txnid,
        lastPaymentId: body.mihpayid || null,
        amount: order.amount,
      }, { merge: true });

      tx.update(orderRef, {
        status: 'success',
        mihpayid: body.mihpayid || null,
        mode: body.mode || null,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Log the activation so the admin Revenue Timeline picks it up.
      // (Timeline reads adminLogs where action='activate_pro'.) amount is the
      // real rupees paid, so revenue is exact, not a plan-based estimate.
      tx.set(db().collection('adminLogs').doc(), {
        action: 'activate_pro',
        uid: order.uid,
        plan: order.planKey,
        planName: cfg.planName,
        amount: Number(order.amount) || 0,
        paymentMode: 'payu',
        txnid,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      tx.update(orderRef, {
        status: 'failed',
        failReason: body.error_Message || body.field9 || body.status || 'failed',
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });

  if (status === 'success' && order.status !== 'success' && order.promoCode) {
    try { await require('./promo').recordRedemption(order.promoCode); }
    catch (e) { console.warn('[PayU] promo redemption failed', e); }
  }
  return { ok: status === 'success', status, txnid, uid: order.uid };
}

/* ════════════════════════════════════════════════════════════════════════
 * 2) payuWebhook — PayU server-to-server. Verified by hash, not auth.
 *    Register THIS url in PayU dashboard → Webhooks / S2S.
 * ════════════════════════════════════════════════════════════════════════ */
const payuWebhook = onRequest(
  { region: REGION, secrets: [PAYU_SALT] },
  async (req, res) => {
    try {
      const result = await processPayuResponse(req.body || {}, PAYU_SALT.value());
      /* A processed response — success or a genuine payment failure — is
         final. 200 tells PayU to stop sending it. */
      res.status(200).json({ received: true, ok: result.ok, reason: result.reason || null });
    } catch (e) {
      /* 500, NOT 200.

         This previously answered 200 on any unexpected error, which tells
         PayU "received, thank you" and stops it ever resending. So a
         transient fault — a Firestore write that timed out, a cold start
         that ran long, a momentary permission blip — permanently destroyed
         that shop's activation. The money was taken, the entitlement was
         never written, and nothing retried: the shop simply stayed locked
         out until a human noticed. That is exactly the failure Rapid Rent
         Services hit.

         PayU resends on a non-2xx, and processRentalPayment() is idempotent
         on txnid (it checks the order is not already 'success' inside the
         transaction), so a retry cannot double-credit anyone. The only cost
         of being wrong here is a duplicate webhook call that no-ops.

         Genuine payment failures still return 200 above — they go through
         processPayuResponse() normally and are not exceptions. This branch
         is only reached when OUR side broke, which is precisely when a
         retry is wanted. */
      console.error('[PayU] webhook error — returning 500 so PayU retries', {
        txnid: (req.body || {}).txnid || null,
        error: e && e.message,
        stack: e && e.stack,
      });
      res.status(500).json({ received: false, retry: true });
    }
  }
);

/* ════════════════════════════════════════════════════════════════════════
 * 3) payuReturn — surl/furl target. PayU POSTs here; we verify then 303-redirect
 *    the browser (POST→GET) back to the app. Sent automatically as surl/furl.
 * ════════════════════════════════════════════════════════════════════════ */
const payuReturn = onRequest(
  { region: REGION, secrets: [PAYU_SALT] },
  async (req, res) => {
    let outcome = 'failed', txnid = '', product = '', back = '';
    try {
      const body = req.body || {};
      txnid = body.txnid || '';
      const result = await processPayuResponse(body, PAYU_SALT.value());
      outcome = result.ok ? 'success' : 'failed';
      product = result.product || '';
      back = result.returnUrl || '';   // Staff360: fixed address chosen on the server
    } catch (e) {
      console.error('[PayU] return error', e);
    }
    /* Send the shopkeeper back to the app they paid from. Dropping a rental
       customer on the HisaabNow dashboard after a successful payment reads
       as "it took my money and lost me". */
    /* '/Rent/' and not '/Rent/rentalnow.html'. The app moved to index.html so
       the PWA's start_url could be the folder root, and rentalnow.html is now
       a redirect stub. Pointing PayU at the stub costs a hop and, worse, any
       stub that forgets to carry the query string swallows ?payu=success — the
       shopkeeper pays, lands on the dashboard, and is told nothing. */
    let url;
    if (back) {
      /* Staff360 addresses carry ?t=<business> and a #/plans screen. */
      const hashAt = back.indexOf('#');
      const head = hashAt >= 0 ? back.slice(0, hashAt) : back;
      const frag = hashAt >= 0 ? back.slice(hashAt) : '';
      url = head + (head.indexOf('?') >= 0 ? '&' : '?') + 'payu=' + encodeURIComponent(outcome) +
            (txnid ? '&txnid=' + encodeURIComponent(txnid) : '') + frag;
    } else {
      const base = APP_ORIGIN + (product === 'rentalnow' ? '/Rent/' : '/');
      url = base + '?payu=' + encodeURIComponent(outcome) +
            (txnid ? '&txnid=' + encodeURIComponent(txnid) : '');
    }
    res.redirect(303, url);
  }
);

/* Shared with payuAutopay.js. Exported rather than duplicated: the plan
   table, the hash helpers and the activation path are the parts an auto-debit
   must agree with EXACTLY, and a second copy of a price table is the bug this
   codebase has already paid for once (see the grandfathering note above). */
module.exports = {
  payuCreateOrder, payuWebhook, payuReturn,
  RN_PLANS, PAYU_KEY, PAYU_SALT, REGION,
  sha512, clean, db, processRentalPayment,
};
