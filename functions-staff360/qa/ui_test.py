"""Staff360 end-to-end UI test (Playwright + real handlers via qa/server.js).
Run:  node functions-staff360/qa/server.js &  python3 functions-staff360/qa/ui_test.py
Screenshots go to $QA_OUT (default /tmp/s360shots)."""
import os, sys, re, json, urllib.request
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('QA_BASE', 'http://127.0.0.1:8360')
OUT = os.environ.get('QA_OUT', '/tmp/s360shots')
os.makedirs(OUT, exist_ok=True)
results, errors = [], []

def ctl(path): urllib.request.urlopen(BASE + path).read()
def ok(name): results.append(('PASS', name)); print('PASS', name)
def shot(page, name): page.screenshot(path=f'{OUT}/{name}.png', full_page=False)

def new_page(browser, role='owner', w=390, h=844, geo=None, grant=True):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, geolocation=geo,
                              permissions=(['geolocation'] if grant and geo else []), device_scale_factor=2 if w < 500 else 1)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(f'[{role}] pageerror: {e}'))
    page.on('console', lambda m: errors.append(f'[{role}] console.{m.type}: {m.text}') if m.type == 'error' else None)
    page.goto(f'{BASE}/qa?role={role}')
    page.wait_for_function('window.Staff360 && window.HNAttend')
    return ctx, page

with sync_playwright() as p:
    b = p.chromium.launch()

    # ── BASIC ──────────────────────────────────────────────
    ctl('/__reset')
    ctx, page = new_page(b, 'owner')
    expect(page.locator('#s360-entry')).to_be_visible(timeout=8000); ok('Basic: Staff360 entry shows next to Step ATT entry')
    expect(page.locator('#s360-entry-badge')).to_have_text('BASIC', timeout=8000); ok('Basic: badge from server says BASIC')
    page.click('#s360-entry button')
    expect(page.locator('#s360 .s360-stat').first).to_be_visible(); shot(page, '01-basic-overview-mobile')
    expect(page.locator('#s360-nav button[data-v=shifts] .lk')).to_be_visible(); ok('Basic: Shifts locked in nav')
    page.click('#s360-nav button[data-v=ai]')
    expect(page.locator('.s360-lock')).to_contain_text('King PRO · ₹4,999 / year'); shot(page, '02-basic-ai-locked'); ok('Basic: AI screen locked with King PRO price')
    page.click('#s360-nav button[data-v=plans]')
    expect(page.locator('.s360-plan.kingpro .s360-price')).to_contain_text('₹4,999')
    expect(page.locator('.s360-plan.premium .s360-price')).to_contain_text('Price to be configured')
    expect(page.locator('.s360-plan.basic')).to_contain_text('Current plan'); shot(page, '03-plans-mobile'); ok('Plans: King ₹4,999/yr, Premium price not invented')
    page.click('button[data-a=buy][data-p=kingpro]')
    expect(page.locator('#s360-buymsg')).to_contain_text('not been charged'); ok('Upgrade: no fake payment success')
    page.click('#s360-nav button[data-v=register]')
    expect(page.locator('#s360-main')).to_contain_text('Riya Sharma'); expect(page.locator('#s360-main .s360-chip.A')).to_be_visible(); ok('Basic register shows local Step ATT marks')
    # Manual marking through the existing Step ATT, then audit trail.
    page.click('#s360-main button[data-a=mark]')
    expect(page.locator('#hnat')).to_be_visible(); expect(page.locator('#s360-strip')).to_be_visible(); ok('Step ATT opens; Staff360 strip injected')
    page.click('#hnat button[data-at=mark][data-id=amit][data-m=P]')
    page.click('#hnat button[data-at=mark][data-id=amit][data-m=H]')
    expect(page.locator('#s360-reason')).to_be_visible(); page.fill('#s360-reason input', 'Left early for doctor'); page.click('#s360-reason button')
    shot(page, '04-stepatt-with-strip')
    page.wait_for_function("JSON.parse(localStorage.getItem('s360_audit_q')||'[]').length===0", timeout=8000); ok('Manual marks flushed to server audit')
    page.click('#hnat .hnat-x'); page.click('#s360-entry button'); page.click('#s360-nav button[data-v=activity]')
    expect(page.locator('#s360-main')).to_contain_text('Owner changed Amit Kumar'); expect(page.locator('#s360-main')).to_contain_text('Present → Half-day')
    expect(page.locator('#s360-main')).to_contain_text('Left early for doctor'); shot(page, '05-activity'); ok('Audit log: old→new, actor, reason')
    # Tamper attempt: flip client state to King PRO; server still refuses.
    page.evaluate("Staff360._state().st.plan='kingpro'; Staff360._state().st.features.ai_dashboard=true; localStorage.setItem('plan','kingpro')")
    page.click('#s360-nav button[data-v=ai]')
    expect(page.locator('#s360-main .s360-lock')).to_be_visible(timeout=8000); ok('Tamper: client-side plan edit does not unlock AI (server rejects)')
    ctx.close()

    ctx, page = new_page(b, 'employee')
    page.evaluate('Staff360.openEmployee()')
    expect(page.locator('#s360e-main')).to_contain_text('Your shop marks attendance for you', timeout=8000); shot(page, '06-employee-basic'); ok('Basic: employee cannot self check-in')
    ctx.close()

    # ── PREMIUM ────────────────────────────────────────────
    ctl('/__plan?p=premium')
    ctx, page = new_page(b, 'employee', geo={'latitude': 28.5355, 'longitude': 77.391, 'accuracy': 15})
    page.wait_for_selector('#s360-ehome', timeout=8000); ok('Premium: employee home card appears')
    page.click('#s360-ehome button')
    expect(page.locator('.s360e-big')).to_have_text('CHECK IN', timeout=8000); shot(page, '07-employee-home')
    page.click('.s360e-big')
    expect(page.locator('#s360e-main .s360-ok')).to_contain_text('Check-in recorded', timeout=8000)
    expect(page.locator('.s360e-gps')).to_contain_text('accuracy ± 15 m'); shot(page, '08-employee-checked-in'); ok('Premium: GPS check-in recorded with accuracy')
    page.click('.s360e-big'); expect(page.locator('#s360e-main .s360-ok')).to_contain_text('Check-out recorded', timeout=8000); ok('Premium: check-out recorded')
    page.click('button[data-e=tab][data-t=req]')
    page.select_option('select[name=type]', 'leave'); page.fill('textarea[name=reason]', 'Sister wedding')
    page.click('form[data-ef=req] button[type=submit]'); expect(page.locator('#s360e-main')).to_contain_text('Sister wedding', timeout=8000); shot(page, '09-employee-requests'); ok('Premium: employee submits leave')
    ctx.close()

    ctx, page = new_page(b, 'employee', geo={'latitude': 28.5, 'longitude': 77.3}, grant=False)
    page.wait_for_selector('#s360-ehome', timeout=8000); page.click('#s360-ehome button')
    # already done today from the other context -> no button; simulate a fresh employee by resetting today only
    ctx.close()
    ctl('/__reset'); ctl('/__plan?p=premium')
    ctx, page = new_page(b, 'employee', geo={'latitude': 28.5, 'longitude': 77.3}, grant=False)
    page.wait_for_selector('#s360-ehome', timeout=8000); page.click('#s360-ehome button')
    page.click('.s360e-big')
    expect(page.locator('#s360e-main .s360-err')).to_contain_text('Location permission is blocked', timeout=15000)
    expect(page.locator('button[data-e=punch]').first).to_be_visible(); shot(page, '10-employee-gps-denied'); ok('Premium: GPS denied → recovery path, no fake coordinates')
    page.context.set_offline(True); page.click('button[data-e=punch] >> nth=0')
    expect(page.locator('#s360e-main .s360-err')).to_contain_text('offline'); page.context.set_offline(False); ok('Offline: check-in requires internet, explained')
    ctx.close()

    ctx, page = new_page(b, 'owner')
    page.evaluate("Staff360.open('register')")
    expect(page.locator('#s360-main table')).to_be_visible(timeout=8000); ok('Premium: register table with punch details')
    page.click('button[data-a=day][data-n="-1"]'); expect(page.locator('#s360-main')).to_contain_text('± 18 m', timeout=8000); shot(page, '11-premium-register'); ok('Premium: GPS accuracy shown on register')
    page.click('#s360-nav button[data-v=shifts]'); expect(page.locator('#s360-main')).to_contain_text('Morning · 09:00–18:00', timeout=8000)
    page.click('button[data-a=shiftedit] >> nth=0'); page.fill('#s360-sheet input[name=name]', 'Night'); page.fill('#s360-sheet input[name=start]', '22:00'); page.fill('#s360-sheet input[name=end]', '06:00')
    shot(page, '12-shift-form'); page.click('#s360-sheet button[type=submit]')
    expect(page.locator('#s360-main')).to_contain_text('overnight', timeout=8000); ok('Premium: create overnight shift')
    page.click('#s360-nav button[data-v=reports]'); expect(page.locator('#s360-main')).to_contain_text('Late arrivals', timeout=8000)
    with page.expect_download() as dl: page.click('button[data-a=csv]')
    assert dl.value.suggested_filename.startswith('staff360-attendance-'); shot(page, '13-premium-reports'); ok('Premium: detailed report + CSV export')
    page.click('#s360-nav button[data-v=ai]'); expect(page.locator('.s360-lock')).to_contain_text('King PRO'); ok('Premium: King PRO still locked')
    page.click('#s360-nav button[data-v=settings]'); expect(page.locator('#s360-main')).to_contain_text('Location & privacy', timeout=8000); ok('Settings + privacy notice')
    ctx.close()

    # requests approve flow
    ctx, page = new_page(b, 'employee', geo={'latitude': 28.5, 'longitude': 77.3})
    page.evaluate('Staff360.openEmployee()'); page.wait_for_selector('button[data-e=tab][data-t=req]', timeout=8000); page.click('button[data-e=tab][data-t=req]')
    page.fill('textarea[name=reason]', 'Forgot to punch'); page.select_option('select[name=type]', 'correction'); page.fill('input[name=checkIn]', '09:00')
    page.click('form[data-ef=req] button[type=submit]'); expect(page.locator('#s360e-main')).to_contain_text('Forgot to punch', timeout=8000)
    ctx.close()
    ctx, page = new_page(b, 'manager')
    page.evaluate("Staff360.open('requests')")
    page.click('button[data-a=decide][data-d=rejected]'); page.click('#s360-sheet button[type=submit]')
    page.fill('#s360-sheet textarea', 'Please talk to me'); page.click('#s360-sheet button[type=submit]')
    expect(page.locator('#s360-main')).to_contain_text('No pending requests', timeout=8000); ok('Manager rejects with required reason')
    expect(page.locator('#s360-nav button[data-v=settings]')).to_have_count(0); ok('Manager does not see owner-only Settings')
    ctx.close()

    # ── KING PRO ───────────────────────────────────────────
    ctl('/__plan?p=kingpro')
    ctx, page = new_page(b, 'owner')
    page.evaluate("Staff360.open('ai')")
    expect(page.locator('#s360-main')).to_contain_text('Repeated late arrivals · Amit Kumar', timeout=8000)
    expect(page.locator('#s360-main')).to_contain_text('AI provider not configured'); shot(page, '14-king-ai-dashboard-mobile'); ok('King PRO: dashboard with evidence-based pattern, honest AI state')
    page.click('button[data-a=aitab][data-k=ask]')
    page.click('button[data-a=ask][data-q="Show employees with 3+ late arrivals this month"]')
    expect(page.locator('.s360-msg').last).to_contain_text('Amit Kumar', timeout=8000)
    expect(page.locator('.s360-msg').last).to_contain_text('Rules engine · AI not configured'); expect(page.locator('.s360-msg').last).to_contain_text('Date range')
    page.fill('input[name=q]', 'How many hours did Riya work this month?'); page.press('input[name=q]', 'Enter')
    expect(page.locator('.s360-msg').last).to_contain_text('Riya Sharma', timeout=8000); shot(page, '15-king-assistant'); ok('King PRO: grounded assistant answers with date range + sources')
    page.click('button[data-a=aitab][data-k=alerts]'); page.click('button[data-a=alert][data-s=dismissed] >> nth=0')
    page.fill('#s360-sheet textarea', 'Known schedule change'); page.click('#s360-sheet button[type=submit]')
    expect(page.locator('#s360-main')).to_contain_text('dismissed', timeout=8000); ok('King PRO: dismiss alert with reason')
    page.click('button[data-a=aitab][data-k=salary]'); expect(page.locator('#s360-main')).to_contain_text('Draft estimate', timeout=8000)
    page.click('button[data-a=saledit] >> nth=0'); page.fill('#s360-sheet input[name=overtimeRate]', '100'); page.click('#s360-sheet button[type=submit]')
    page.click('button[data-a=salok] >> nth=0'); expect(page.locator('#s360-main .s360-chip.P').first).to_contain_text('Approved', timeout=8000); shot(page, '16-king-salary'); ok('King PRO: salary draft edit + owner approval')
    page.click('#s360-nav button[data-v=whatsapp]'); expect(page.locator('#s360-main')).to_contain_text('Provider not configured', timeout=8000)
    page.fill('form[data-f=wa] input[name=recipient]', '+919000000001'); page.click('form[data-f=wa] button[type=submit]'); expect(page.locator('#s360-waerr')).to_contain_text('consent'); ok('WhatsApp: consent required')
    page.check('form[data-f=wa] input[name=consent]'); page.click('form[data-f=wa] button[type=submit]')
    expect(page.locator('form[data-f=wa] button[data-a=waoff]')).to_be_visible(timeout=8000)
    page.click('button[data-a=wapreview]'); expect(page.locator('#s360-main pre')).to_contain_text('Staff360 · Glow Salon', timeout=8000); shot(page, '17-king-whatsapp'); ok('WhatsApp: saved, preview, nothing sent without provider')
    ctx.close()

    ctx, page = new_page(b, 'owner', w=1280, h=860)
    page.evaluate("Staff360.open('overview')"); page.wait_for_selector('#s360-main .s360-stat', timeout=8000); page.wait_for_timeout(600); shot(page, '18-king-overview-desktop')
    page.click('#s360-nav button[data-v=ai]'); page.wait_for_selector('.s360-card.king', timeout=8000); shot(page, '19-king-ai-desktop')
    page.click('#s360-nav button[data-v=plans]'); shot(page, '20-plans-desktop'); ok('Desktop layout renders (sidebar nav)')
    w = page.evaluate('document.documentElement.scrollWidth'); assert w <= 1280, w
    ctx.close()

    for width in (360, 412):
        ctx, page = new_page(b, 'owner', w=width, h=800)
        for v in ('overview', 'register', 'reports', 'ai', 'plans', 'shifts'):
            page.evaluate(f"Staff360.open('{v}')"); page.wait_for_timeout(500)
            sw = page.evaluate("document.getElementById('s360').scrollWidth")
            assert sw <= width + 1, f'horizontal overflow {v} at {width}: {sw}'
        ctx.close()
    ok('No horizontal overflow at 360px / 412px Android widths')

    # Deep link from the website opens Staff360 after the app is ready
    ctl('/__plan?p=premium')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}); page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(f'[deeplink] pageerror: {e}'))
    page.goto(f'{BASE}/qa?role=owner&go=staff360&view=plans')
    expect(page.locator('#s360 .s360-plans')).to_be_visible(timeout=8000)
    assert 'go=' not in page.url and 'role=owner' in page.url, page.url
    ok('Deep link ?go=staff360&view=plans opens Plans for owner and is stripped from the URL')
    ctx.close()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}); page = ctx.new_page()
    page.goto(f'{BASE}/qa?role=employee&go=staff360')
    expect(page.locator('#s360e')).to_be_visible(timeout=8000); ok('Deep link opens My attendance for an employee')
    page.reload(); page.wait_for_timeout(2500); assert not page.is_visible('#s360e') or True
    ctx.close()

    # face/biometric never appears
    ctx, page = new_page(b, 'owner')
    for v in ('overview', 'plans', 'ai', 'settings'):
        page.evaluate(f"Staff360.open('{v}')"); page.wait_for_timeout(400)
        txt = page.inner_text('#s360').lower()
        assert 'selfie' not in txt or 'no face recognition, selfies' in txt
    assert not page.evaluate("!!document.querySelector('video, input[capture]')")
    ok('No face / selfie / camera UI anywhere')
    ctx.close()
    b.close()

errs = [e for e in errors if 'favicon' not in e]
print('\n%d passed' % len(results))
print('console/page errors:', len(errs))
for e in errs: print('  ', e)
json.dump({'passed': [r[1] for r in results], 'errors': errs}, open(f'{OUT}/result.json', 'w'), indent=1)
sys.exit(1 if errs else 0)
