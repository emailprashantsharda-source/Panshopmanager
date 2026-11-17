# Staff360 — Phase A repository audit

Branch: `feature/staff360` (cut from `main` @ `59056f9`, build `v34_auto_20261117_1600`).
Nothing in the running app has been changed. This file is the only addition.

## 1. Verified facts

| Area | What the repo actually contains |
|---|---|
| Stack | Static PWA. No React/Next/Vite, no `package.json`, no build step in this repo. |
| Hosting | GitHub Pages (`CNAME` = `app.hisaabnow.com`, `.nojekyll`). **A push to `main` is a production deploy.** |
| App shell | `index.html` — 4.77 MB, 11,618 lines, dozens of inline `<script>` "Step" modules (IIFEs on `window.*`). |
| Other areas | `admin/` (separate admin panel v3.4), `Rent/` (RentalNow + SEO pages), `legal/` (privacy, terms, delete-account). |
| Service workers | `sw.js` (stale-while-revalidate for the HTML, cache-first for other same-origin GETs; `SW_VERSION` must match `HISAABNOW_BUILD`), `firebase-sw.js`, `firebase-messaging-sw.js`. |
| Firebase | JS SDK 10.12.2 (modular, from gstatic). Prod project `panshopmanager`; **staging project `hisaabnow-staging`** auto-selected on `staging.hisaabnow.com`, `*.github.io`, `localhost`. App Check (reCAPTCHA v3) enforced. IndexedDB persistence on. |
| Auth | Phone OTP. `users/{uid}`, `users/{uid}/shops/{shopId}` index, canonical `shops/{shopId}` with `ownerId`. |
| Tenant model | **`shops/{shopId}` is the tenant** (PRD's `businesses/{businessId}` maps to this). Multi-shop via `MShop`. |
| Data sync | `HisaabSync` v2.5.0 writes `shops/{shopId}/{collection}/{docId}` for ~30 collections (`staff`, `sales`, `expenses`, `agents`, …), mirrored into `window.S` + localStorage, accessed through `window.Store`. |
| Roles | `owner`, `manager`, `cashier`, `waiter` (+ `helper` label). Staff log in with their own phone: `staffPhoneIndex/{phone}/shops/{shopId}` → `StaffDiscovery`. Staff add/update/remove go through Cloud Functions `addStaffMember`, `updateStaffMember`, `removeStaffMember`, `listShopStaff`. Client role is exposed as `<html data-current-role>` (cached in `localStorage.hn_role_cached`). |
| Plans | `window.Subs`: `trial`, `basic` (₹99/m), `pro` (₹499/m · ₹4,990/yr), `king` (₹799/m · ₹7,990/yr), `expired`. Server truth via callable `getSubscription`; client reconciles. |
| Payments | PayU (`payuCreateOrder`) on web, Google Play Billing (`verifyPlayPurchase`) in the TWA. Promo codes via `validatePromo`. |
| AI | Server-side callables already exist: `getMyBizInsights` (has a daily limit → `resource-exhausted`), `hnAdvisorTTS`, `parseMenuImage`, HTTP `extractProductsFromPhoto`, `generateStarterCatalog`. No model keys in the client. |
| Audit | `AuditLog.record(...)` + callable `logAuditEvent` already exist. |
| Design | Tokens in `:root` — `--emerald #0F5F3F`, `--emerald-2 #1B7A52`, `--emerald-tint #E8F3EE`, gold `--y #FFC043`, warm-cream surfaces, Inter + Noto Sans Devanagari. Matches the PRD direction (emerald primary, gold for King). |
| **Existing attendance** | **"Step ATT" (index.html ~L11297–11400), Nov 2026.** Salon-only. Owner/manager marks P / H / A / L(eave) / W(eek off) per day; optional in/out times; shop-device punch kiosk with optional 4-digit PIN; staff advances written as `hr_salaries/staff_advance` expenses; month report, CSV, WhatsApp share text. Stored in synced `agents` collection as `kind:"hn_att"` docs (`att_{staffId}_{YYYY-MM}`) and `kind:"hn_att_cfg"`. Kill switch `localStorage.HN_ATT="off"`. Its own comment says staff-own-login punching was not built **because Firestore rules would need to change.** |

## 2. Not in this repo (blocks server-side work)

- `firestore.rules`, `firestore.indexes.json`, `firebase.json`
- Cloud Functions source (`getSubscription`, `addStaffMember`, `getMyBizInsights`, PayU callbacks …). Per notes these live locally at `C:\dev\hisaabnow\functions` (pnpm).

Consequence: every "enforce server-side" requirement (plan gating, employee-only-own-data, cross-shop denial, AI, WhatsApp, payments) depends on files I cannot see. Writing a fresh `firestore.rules` blind and deploying it would **replace** the live rules for every existing module.

## 3. Conflicts between the PRD and the existing app

1. **Plan names and price.** App sells `Basic / Pro / King` (King ₹7,990/yr). PRD sells Staff360 `Basic / Premium / King PRO` at ₹4,999/yr. Needs a decision: separate Staff360 add-on, or mapped onto app tiers.
2. **Statuses.** PRD: Present/Absent/Half-day. App already has Leave and Week off — PRD allows keeping existing statuses; plan is to keep them.
3. **Collection shape.** PRD suggests `attendance/{id}` per punch. App stores a month doc per staff in `agents`. Employee self-punch with tamper-proof server timestamps needs per-punch docs written through a Cloud Function (staff can't be allowed to write month docs directly).
4. **Timezone.** App uses device-local dates. Staff360 will derive dates in the shop timezone (default `Asia/Kolkata`).

## 4. Proposed integration (pending decisions)

- **Extend Step ATT, don't fork it.** Ship Staff360 as `staff360/staff360.js` + `staff360/staff360.css` loaded by one `<script defer>` tag, with Step ATT data read as-is (no migration needed for Basic).
- Central entitlement map `STAFF360_PLANS` in one file; UI reads it, **server re-checks** in every callable.
- Premium punches: new callable `staff360Punch` (server time, shop TZ, duplicate guard, GPS payload, role check) → `shops/{shopId}/staff360Punches/{id}`; rules make that collection client-read-only.
- King PRO AI: new callable `staff360Ask` with fixed query tools over attendance data, per-shop rate limit, disabled state if no key. Reuse whatever provider `getMyBizInsights` already uses.
- WhatsApp: settings + opt-in only; sending blocked until the BSP is configured server-side.
- `sw.js`: add the two new files to the cache, bump `SW_VERSION` and `HISAABNOW_BUILD` together.
- Kill switch + salon-first flag, matching existing pattern; nothing visible to live clients until approved.

## 5. Risks

- Pushing to `main` deploys to all live clients immediately (GitHub Pages).
- Rules deploy without the current rules file could lock users out of existing modules.
- Staging hosting origin (`staging.hisaabnow.com`) — which repo/branch serves it is not visible here.
- `index.html` size: any new code inline adds to a 4.7 MB first load; external file avoids that.
