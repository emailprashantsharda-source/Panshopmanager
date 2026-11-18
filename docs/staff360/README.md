# Staff360 — build, deploy & rollback

Branch `feature/staff360`. Nothing here is live until it is merged to `main`
(GitHub Pages deploys `main` to app.hisaabnow.com) **and** the server part is
deployed. Phase A audit: [PHASE_A_AUDIT.md](PHASE_A_AUDIT.md).

## 1. What was built

| Layer | Files | Notes |
|---|---|---|
| Client | `staff360/staff360.js`, `staff360/staff360.css` | Loaded by one `<script defer>` at the end of `index.html`. Renders only. |
| Existing app (small edits) | `index.html`, `sw.js` | Script tag; 1-line audit hook in Step ATT `setMark`; Step ATT opened to **all business types** (re-limit per device with `localStorage.HN_ATT_VERTS="salon"`); build stamp bumped in both files (`v34_auto_20261118_0015`). |
| Server | `functions-staff360/staff360/*.js` | 23 callables + 1 scheduled function. All plan / role / tenant checks live here. |
| Rules | `functions-staff360/firestore.staff360.rules` | **Snippet** to paste into your existing rules — not a full file. |
| Tests | `functions-staff360/test/*`, `functions-staff360/qa/*` | Unit + handler (denied-access) tests, end-to-end UI test. |

Decisions taken (from your answers): Staff360 is a **separate add-on**; the
existing Step ATT attendance **is Basic** and is unchanged; Premium and
King PRO appear **with locks**; **staging first**.

## 2. Screens & who sees them

| Screen | Owner | Manager | Employee | Plan |
|---|---|---|---|---|
| Overview (today cards, quick actions, upgrade card) | ✓ | ✓ | – | Basic |
| Team (search/filter; add/edit via existing Staff screen) | ✓ | ✓ | – | Basic |
| Register + manual marking (existing Step ATT) | ✓ | ✓ | – | Basic |
| Register with punch times, hours, GPS accuracy, map link | ✓ | ✓ | – | Premium |
| Shifts & weekly offs (overnight supported) | ✓ | ✓ | – | Premium |
| Leave & correction requests (approve / reject + reason) | ✓ | ✓ | submit own | Premium |
| Reports — totals (Basic) / hours, late, CSV (Premium) | ✓ | ✓ | – | Basic / Premium |
| Settings: timezone, GPS policy, accuracy, privacy copy | ✓ | – | – | Premium |
| Activity / audit log | ✓ | ✓ | – | Basic |
| Plans (₹4,999/yr King PRO; others "Price to be configured") | ✓ | ✓ | – | all |
| My attendance: check in/out with GPS, history, requests | ✓* | ✓* | ✓ | Premium |
| AI Staff Manager: summary, patterns, availability | ✓ | ✓ | – | King PRO |
| Ask Staff360 AI (grounded, date range, source records) | ✓ | ✓ | – | King PRO |
| Patterns to review: evidence, review / dismiss | ✓ | ✓ | – | King PRO |
| Salary assistant: formula, edit inputs, approve (owner only) | ✓ | edit | – | King PRO |
| WhatsApp reports: opt-in, preview, log, turn off | ✓ | – | – | King PRO |

\* when their phone matches a staff profile.

## 3. Data (all server-owned, top-level, clients have no direct access)

`staff360Entitlements/{shopId}` · `staff360Config/plans` · `staff360WaSchedule/{shopId}` ·
`staff360/{shopId}` (settings) with sub-collections `punches`, `punchLog`, `shifts`,
`requests`, `audit`, `insights`, `salary`, `aiUsage`, `aiUsageLog`, `whatsapp`, `whatsappLog`, `orders`.

Read from existing data: `shops/{id}`, `staffPhoneIndex`, `shops/{id}/staff`,
`shops/{id}/expenses` (staff advances), `shops/{id}/agents/att_*` (Step ATT).
Written into existing data (toggle in Settings): employee punches and approved
leave/corrections are mirrored into the Step ATT month doc so its register,
month report and salary keep working.

No new composite indexes are needed (all queries are single-field). No migration:
Basic keeps using Step ATT data as it is.

## 4. Configuration checklist (owner)

| Item | Where | Default |
|---|---|---|
| Admin UIDs who can grant plans / set prices | env `STAFF360_ADMIN_UIDS` (comma list) or custom claim `admin:true` | none — nobody |
| Basic / Premium price, staff limits | call `staff360AdminSetPlanConfig` | "Price to be configured", no limit |
| King PRO price | same | ₹4,999 / year |
| Grant a plan (until payments are wired) | call `staff360AdminSetPlan {shopId, planId, months}` | Basic |
| Online payment | wire existing PayU into `providers.js → createBilling`, set `STAFF360_BILLING_ENABLED=true`, call `activatePlan` only from the **verified** PayU callback | off — UI says "not charged" |
| AI | `STAFF360_AI_PROVIDER` (`anthropic`/`openai`), `STAFF360_AI_MODEL`, key secret, optional `STAFF360_AI_DAILY_LIMIT` (40) | off — rules mode, clearly labelled |
| WhatsApp | `STAFF360_WA_TOKEN`, `STAFF360_WA_PHONE_ID`, approved template `STAFF360_WA_TEMPLATE` (one body variable), `STAFF360_WA_TEMPLATE_LANG` | off — nothing is ever sent |
| Region / App Check | `STAFF360_REGION` (us-central1), `STAFF360_ENFORCE_APPCHECK` (true) | |
| Business timezone, GPS policy | in-app Settings | Asia/Kolkata, GPS required, flag > 150 m |

## 5. Deploy to STAGING (step by step)

1. Copy server code into your functions project:
   ```
   cd C:\dev\hisaabnow
   git -C C:\path\to\Panshopmanager checkout feature/staff360
   xcopy /E /I C:\path\to\Panshopmanager\functions-staff360\staff360 functions\staff360
   ```
2. At the bottom of `functions\index.js` add:
   ```js
   Object.assign(exports, require('./staff360'));
   ```
3. Merge the rules snippet: open `firestore.rules`, paste the four `match` blocks from
   `functions-staff360/firestore.staff360.rules` inside `match /databases/{database}/documents { … }`.
   Check there is no catch-all `match /{document=**}` allow (see note in the snippet).
4. Set your admin UID and deploy to staging only:
   ```
   echo STAFF360_ADMIN_UIDS=<your-uid> >> functions\.env.hisaabnow-staging
   firebase deploy --only firestore:rules --project hisaabnow-staging
   firebase deploy --only functions --project hisaabnow-staging
   ```
5. Run the rules test against your real merged rules:
   ```
   npm i -D @firebase/rules-unit-testing
   firebase emulators:exec --only firestore "node --test functions/staff360/test/rules.emulator.test.js"
   ```
6. Serve the branch on the staging origin (the app switches to `hisaabnow-staging`
   automatically on `staging.hisaabnow.com`, `*.github.io` and `localhost`):
   ```
   cd C:\path\to\Panshopmanager
   npx http-server -p 8080
   ```
   then open `http://localhost:8080`, sign in to a staging salon shop, open
   Staff → Staff360. Grant Premium/King PRO with `staff360AdminSetPlan` to test.
7. Test checklist on staging: owner/manager/employee on all three plans, GPS allow /
   deny on an Android phone, a check-in from another shop's employee (must fail),
   PWA install + offline open, and every existing module (billing, POS, inventory,
   suppliers, salon appointments, rental, admin).

## 6. Production (only after your explicit approval)

1. Deploy rules + functions to `panshopmanager` (same commands, `--project panshopmanager`).
2. Merge the PR to `main` → GitHub Pages publishes. `SW_VERSION` and `HISAABNOW_BUILD`
   already match, so phones pick up the new build on the next open.
3. Before merging, decide whether `functions-staff360/` and `docs/` should be
   published on app.hisaabnow.com (GitHub Pages serves every file in `main`). They
   contain no secrets, but you may prefer to move them to your private functions repo.

## 7. Rollback

| Need | Do |
|---|---|
| Hide Staff360 on one device | `localStorage.setItem('HN_S360','off'); location.reload()` |
| Remove from the app | revert the merge commit on `main` (`git revert -m 1 <merge-sha>`), bump both build stamps, push |
| Stop server features | `firebase functions:delete staff360GetState …` (or remove the `Object.assign` line and redeploy). Client shows "Server setup pending"; Basic keeps working |
| Rules | remove the four Staff360 match blocks and redeploy rules |
| Data | nothing to undo for Basic. Staff360 data sits under its own top-level collections and can be left or deleted |

## 8. Test report (this branch)

* `cd functions-staff360 && npm test` → **33/33 pass**: plan matrix and ₹4,999, no invented
  prices; entitlement active/grace/expiry; shop-timezone dates; late/grace; overnight
  shifts; GPS validation (no fake / stale coordinates); salary formula; anomaly evidence
  and neutral wording; assistant grounding; pseudonymisation; **denied access**:
  unauthenticated, other shop's owner, other shop's employee, inactive membership,
  employee → owner functions, manager → other shop, manager → owner-only settings /
  salary approval / WhatsApp, owner → self-grant plan, Premium → King PRO, Basic → Premium;
  duplicate punches; WhatsApp needs consent + provider + plan; AI provider never sees names
  or phones; AI rate limit; no fake payment success; data kept after expiry.
* `qa/ui_test.py` (real Step ATT code + real handlers, Chromium) → **35/35 pass**, 0 console
  errors, at 360 / 390 / 412 px and 1280 px; includes a client-side plan tamper attempt
  (server still refuses) and checks that no camera / selfie UI exists.
* Regression: full `index.html` loaded from `main` vs this branch — identical console
  errors (only the Firebase CDN, blocked in the build sandbox), Step ATT, App and Store load.

**Not tested here (needs your machine / staging):** Firestore rules in the emulator
(Java download blocked in sandbox — test file provided), real Firebase Auth/App Check,
real phone GPS, PWA install, existing modules end-to-end with real data, PayU, WhatsApp.

## 9. Known limitations / owner decisions

1. **Employee login**: self check-in works for staff whose phone has a HisaabNow login
   (Cashier / Manager / Waiter roles today). Stylists/helpers need an "attendance-only"
   login role — that requires a change in your `addStaffMember` function and app role
   routing, which are not in this repo. Until then they punch on the shop device (Basic kiosk).
2. **Payments** are not wired (PayU source not in repo). Plans are granted by an admin.
3. **Geofencing** is not implemented; location is evidence with accuracy, not proof.
4. **Offline punches** are not queued — check-in needs internet (explained in the UI).
5. **Manager store scope** = the shops where they have a manager membership (HisaabNow's
   tenant is the shop).
6. Basic manual marks are written by the existing client sync; the audit entry is
   server-stamped (actor, time) but the old/new values come from the device.
7. Mirroring punches into the Step ATT month doc writes `days.<date>` and `_lastUpdated`;
   please confirm on staging that HisaabSync picks this up cleanly.
8. Visible for every business type. Website deep link: `https://app.hisaabnow.com/?go=staff360` (add `&view=plans` for the plans screen) — survives login and opens the hub for owners/managers and My attendance for employees.
