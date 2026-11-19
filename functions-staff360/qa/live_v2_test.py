"""Staff360 v2 on the live shell (hisaabnow.com/staff360/app) against the REAL handlers.
  SITE_ROOT=/path/to/dukaanai node functions-staff360/qa/server.js &
  python3 functions-staff360/qa/live_v2_test.py"""
import os, re, urllib.request
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('QA_BASE', 'http://127.0.0.1:8360')
OUT = os.environ.get('QA_OUT', '/tmp/s360live'); os.makedirs(OUT, exist_ok=True)
passed, errors = [], []
def ok(n): passed.append(n); print('PASS', n)
def ctl(p): urllib.request.urlopen(BASE + p).read()
FB = os.path.join(os.path.dirname(__file__), 'mock-firebase')

def page_for(b, w=1440, h=900, geo=None):
    ctx = b.new_context(viewport={'width': w, 'height': h}, geolocation=geo, permissions=['geolocation'] if geo else [], accept_downloads=True)
    ctx.route('https://www.gstatic.com/firebasejs/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=open(os.path.join(FB, r.request.url.split('/')[-1].split('?')[0])).read()))
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    pg.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type == 'error' and 'favicon' not in m.text else None)
    return ctx, pg

def login(pg, phone):
    pg.goto(BASE + '/staff360/login/')
    pg.fill('#phone', phone); pg.click('#send'); expect(pg.locator('#f-otp')).to_be_visible()
    pg.fill('#otp', '123456'); pg.wait_for_url('**/staff360/app/**', timeout=8000)

def overflow(pg): return pg.evaluate('document.documentElement.scrollWidth-innerWidth')

with sync_playwright() as p:
    b = p.chromium.launch(); ctl('/__reset')

    # 1) New owner: sign up a Staff360 business → v2 dashboard on Basic
    ctx, pg = page_for(b)
    login(pg, '9800000001')
    pg.fill('#su input[name=name]', 'Sharma Clinic'); pg.click('#su button[type=submit]')
    expect(pg.locator('#s360v2 .page-h h1')).to_contain_text('Good', timeout=10000)
    expect(pg.locator('.shop-a')).to_contain_text('Sharma Clinic'); expect(pg.locator('.plan-chip.live')).to_have_text('Basic')
    assert pg.locator('.sample').count() == 0 and pg.locator('.demo-plans').count() == 0; ok('Sign-up opens the new dashboard (Basic, no demo controls)')
    org = pg.evaluate("localStorage.getItem('s360_tenant')")
    pg.goto(BASE + '/staff360/app/#/staff'); expect(pg.locator('#s360v2 h1')).to_contain_text('Staff Management', timeout=8000)
    pg.click('#s360v2 .page-h [data-a=staff-add]')
    pg.fill('#m-name', 'Neha Verma'); pg.fill('#m-mobile', '9800000002'); pg.fill('#m-desig', 'Receptionist'); pg.fill('#m-id', 'emp-01'); pg.fill('#m-salary', '15000')
    pg.click('#s360-modal button[type=submit]')
    expect(pg.locator('.prof-h h1')).to_contain_text('Neha Verma', timeout=8000); expect(pg.locator('.prof-h p')).to_contain_text('EMP-01'); ok('Add employee saves on the server, opens their profile')
    pg.click('.prof-h [data-a^="att-edit"]'); pg.click('#s360-modal button[type=submit]')
    pg.wait_for_timeout(800); pg.reload(); expect(pg.locator('.prof-h')).to_be_visible(timeout=8000)
    expect(pg.locator('section.card:has(h2:text-is("Today"))')).to_contain_text('Present'); ok('Mark today persists after reload')
    pg.goto(BASE + '/staff360/app/#/shifts'); expect(pg.locator('main h1')).to_contain_text('is on Premium'); ok('Basic: shifts locked by plan')
    pg.goto(BASE + '/staff360/app/#/settings'); pg.fill('#s-bn', 'Sharma Family Clinic'); pg.click('form[data-set=business] button[type=submit]')
    pg.wait_for_timeout(800); pg.reload(); expect(pg.locator('.shop-a')).to_contain_text('Sharma Family Clinic', timeout=8000); ok('Rename business saved on the server')
    pg.screenshot(path=f'{OUT}/01-org-basic.png')

    # 2) Premium: shifts, leave on behalf, reject needs reason, employee check-in
    ctl(f'/__plan?p=premium&shop={org}'); pg.goto(BASE + '/staff360/app/#/shifts'); pg.reload()
    expect(pg.locator('main h1')).to_contain_text('Shifts', timeout=8000)
    pg.click('[data-a=shift-new]'); pg.fill('#m-sn', 'Day'); pg.fill('#m-ss', '09:00'); pg.fill('#m-se', '17:00'); pg.fill('#m-sg', '5'); pg.click('#s360-modal button[type=submit]')
    pg.wait_for_timeout(900); expect(pg.locator('.shift-c', has_text='Day')).to_be_visible(timeout=8000)
    pg.reload(); expect(pg.locator('.shift-c', has_text='Day')).to_be_visible(timeout=8000)
    for _ in range(3):
        pg.locator('.sched tbody tr', has_text='Neha').locator('.slot').first.click()
        if pg.locator('#m-as').count(): break
        pg.wait_for_timeout(500)
    pg.select_option('#m-as', label='Day (9:00 AM–5:00 PM)'); pg.select_option('#m-ao', '0'); pg.click('#s360-modal button[type=submit]')
    pg.wait_for_timeout(1200); pg.reload(); expect(pg.locator('.shift-c', has_text='Day')).to_contain_text('1 staff', timeout=8000); ok('Premium: create shift + assign staff and weekly off (server)')
    pg.goto(BASE + '/staff360/app/#/leave'); pg.click('[data-a=leave-new]'); pg.fill('#m-lr', 'Family function'); pg.click('#s360-modal button[type=submit]')
    pg.wait_for_timeout(900); expect(pg.locator('tbody')).to_contain_text('Family function', timeout=8000)
    pg.locator('tbody tr', has_text='Family function').locator('button.no').click(); pg.click('#s360-modal button[type=submit]')
    expect(pg.locator('[data-err=note]')).to_contain_text('reason'); pg.fill('#m-rn', 'Busy week'); pg.click('#s360-modal button[type=submit]')
    pg.wait_for_timeout(900); pg.reload(); expect(pg.locator('tbody tr', has_text='Family function')).to_contain_text('Rejected', timeout=8000); ok('Leave on behalf; reject requires a reason; saved')
    pg.goto(BASE + '/staff360/app/#/staff'); pg.locator('tbody tr', has_text='Neha').locator('[data-a^="staff-edit"]').click()
    pg.locator('#s360-modal label.switch').click(); expect(pg.locator('#s360-modal input[name=login]')).to_be_checked()
    pg.click('#s360-modal button[type=submit]'); expect(pg.locator('.toast')).to_contain_text('Saved changes', timeout=8000); pg.wait_for_timeout(800)
    pg.goto(BASE + '/staff360/app/#/staff'); pg.reload(); pg.locator('tbody tr', has_text='Neha').locator('a.who').click()
    expect(pg.locator('.dl', has_text='Employee login')).to_contain_text('Enabled', timeout=8000); ok('Premium: owner turns on Neha’s Staff360 login')
    pg.goto(BASE + '/staff360/app/#/settings')
    pg.fill('#s-glat', '28.62'); pg.fill('#s-glng', '77.37'); pg.fill('#s-grad', '200'); pg.select_option('#s-gmode', 'block')
    pg.click('form[data-set=fence] button[type=submit]'); pg.wait_for_timeout(1000)
    pg.locator('form[data-set=rules] label.switch:has(input[name=autoHalfDay])').click(); pg.click('form[data-set=rules] button[type=submit]'); pg.wait_for_timeout(1000)
    pg.reload(); expect(pg.locator('#s-gmode')).to_have_value('block', timeout=8000); expect(pg.locator('input[name=autoHalfDay]')).to_be_checked(); ok('Shop location + auto half-day saved')
    ctx.close()

    ectx, ep = page_for(b, 390, 844, geo={'latitude': 28.70, 'longitude': 77.37, 'accuracy': 25})
    login(ep, '9800000002')
    expect(ep.locator('#s360emp .emp-hello')).to_contain_text('Neha', timeout=10000)
    expect(ep.locator('.emp-punch')).to_contain_text('within 200 m')
    ep.click('[data-e="punch:in"]'); expect(ep.locator('.sheet')).to_contain_text('Location captured', timeout=8000); ep.click('.sheet [data-e^="confirm"]')
    expect(ep.locator('.toast')).to_contain_text('km from the shop', timeout=8000); expect(ep.locator('.emp-punch')).to_contain_text('Check in'); ok('Shop-distance check: blocked 8.9 km away')
    ectx.set_geolocation({'latitude': 28.6201, 'longitude': 77.3701, 'accuracy': 25})
    ep.click('[data-e="punch:in"]'); expect(ep.locator('.sheet')).to_contain_text('Location captured', timeout=8000)
    assert ep.locator('.sim').count() == 0
    ep.click('.sheet [data-e^="confirm"]'); expect(ep.locator('.emp-punch')).to_contain_text('Checked in', timeout=8000)
    expect(ep.locator('.gps-ok')).to_contain_text('±25 m'); ok('Employee: real GPS reading at check-in, saved by the server')
    ep.screenshot(path=f'{OUT}/02-employee-checked-in.png')
    ep.goto(BASE + '/staff360/app/#/attendance'); ep.click('[data-e="fix:' + ep.evaluate('S360Store.today') + '"] >> nth=0')
    ep.fill('#m-fi', '09:00'); ep.fill('#m-fr', 'Reached at 9, forgot to tap'); ep.click('#s360-modal button[type=submit]')
    ep.wait_for_timeout(1200); ep.reload(); expect(ep.locator('.card', has_text='My correction requests')).to_contain_text('Pending', timeout=8000); ok('Employee asks for a correction')
    ep.goto(BASE + '/staff360/app/#/leave'); ep.click('[data-e=leave-new]'); ep.fill('#m-lr', 'Doctor visit'); ep.click('#s360-modal button[type=submit]')
    ep.wait_for_timeout(1000); expect(ep.locator('.list')).to_contain_text('Pending', timeout=8000); ok('Employee leave request')
    ep.goto(BASE + '/staff360/app/#/profile'); assert ep.locator('#emp-prof').count() == 0; assert overflow(ep) <= 0
    ep.click('[data-e=logout]'); ep.wait_for_url('**/staff360/login/**', timeout=8000); ok('Employee profile read-only; log out')
    ectx.close()

    # Owner: approve the correction, mark yesterday's no-shows absent
    ctx, pg = page_for(b); login(pg, '9800000001')
    expect(pg.locator('#s360v2 .page-h h1')).to_be_visible(timeout=10000)
    pg.goto(BASE + '/staff360/app/#/leave/corrections'); row = pg.locator('tbody tr', has_text='Neha')
    expect(row).to_contain_text('In 9:00 AM', timeout=8000); row.locator('button.ok').click(); pg.wait_for_timeout(1200); pg.reload()
    expect(pg.locator('tbody tr', has_text='Neha')).to_contain_text('Approved', timeout=8000)
    pg.goto(BASE + '/staff360/app/#/attendance'); expect(pg.locator('tbody tr', has_text='Neha').locator('td').nth(3)).to_contain_text('9:00 AM', timeout=8000); ok('Owner approves correction; register updated')
    pg.click('[data-a="att-day:-1"]'); pg.click('[data-a=att-noshow]'); expect(pg.locator('#s360-modal')).to_contain_text('Neha'); pg.click('#s360-modal button[type=submit]')
    expect(pg.locator('.toast')).to_contain_text('1 marked absent', timeout=8000); expect(pg.locator('tbody tr', has_text='Neha')).to_contain_text('Absent', timeout=8000); ok('Mark no-shows absent (server)')
    ctx.close()

    # 3) HisaabNow shop owner on King PRO: shared data, add-staff info, AI, salary
    ctl('/__plan?p=kingpro')
    ctx, pg = page_for(b)
    login(pg, '9000000001')
    pg.wait_for_timeout(500)
    if pg.locator('#boot .pick').count(): pg.locator('#boot .pick', has_text='Glow Salon').click()
    expect(pg.locator('#s360v2 .page-h h1')).to_be_visible(timeout=10000)
    expect(pg.locator('.kpi', has_text='Total Staff').locator('b')).to_have_text('4'); ok('Shop: dashboard shows the HisaabNow staff')
    pg.screenshot(path=f'{OUT}/03-shop-dashboard.png', full_page=True)
    pg.goto(BASE + '/staff360/app/#/staff/amit'); pg.click('[data-a="ptab:history"]'); expect(pg.locator('tbody')).to_contain_text('Late', timeout=8000); ok('Shop: punch history (late) from the server')
    pg.goto(BASE + '/staff360/app/#/staff'); pg.click('#s360v2 .page-h [data-a=staff-add]'); expect(pg.locator('#s360-modal')).to_contain_text('HisaabNow app'); pg.keyboard.press('Escape'); ok('Shop: add staff explains the HisaabNow app')
    pg.goto(BASE + '/staff360/app/#/attendance'); row = pg.locator('tbody tr', has_text='Vikas Singh')
    row.locator('[data-a^="att-quick"]', has_text='Absent').click(); pg.wait_for_timeout(1000); pg.reload()
    expect(pg.locator('tbody tr', has_text='Vikas Singh')).to_contain_text('Absent', timeout=8000); ok('Shop: quick mark saved to the shared register')
    pg.goto(BASE + '/staff360/app/#/reports'); expect(pg.locator('svg.chart').first).to_be_visible(timeout=8000)
    with pg.expect_download() as d: pg.click('.page-h [data-a="rep-csv:daily"]')
    ok('Reports + CSV on live data')
    pg.goto(BASE + '/staff360/app/#/ai'); pg.click('[data-a="ai-ask:1"]'); expect(pg.locator('.msg.ai')).to_contain_text(re.compile('Amit|late', re.I), timeout=8000); ok('AI: question answered by the server (rules mode)')
    expect(pg.locator('.sal-out')).to_be_visible(timeout=8000); pg.fill('#sl-overtimeRate', '100'); pg.click('#sl-form button[type=submit]'); expect(pg.locator('.toast')).to_contain_text('updated', timeout=8000)
    pg.click('[data-a=sl-approve]'); pg.click('#s360-modal button[type=submit]'); expect(pg.locator('.ok-note')).to_contain_text('No payment', timeout=8000); ok('Salary estimate recalculated + approved on the server')
    pg.screenshot(path=f'{OUT}/04-shop-ai.png', full_page=True)
    pg.goto(BASE + '/staff360/app/#/settings'); expect(pg.locator('form[data-set=wa]')).to_be_visible(timeout=8000)
    pg.fill('#s-war', '9876500000'); pg.click('form[data-set=wa] button[type=submit]'); expect(pg.locator('[data-err=consent]')).to_contain_text('Tick')
    pg.check('form[data-set=wa] input[name=consent]'); pg.click('form[data-set=wa] button[type=submit]')
    expect(pg.locator('.toast')).to_contain_text('Nothing will be sent', timeout=8000); expect(pg.locator('form[data-set=wa] .ok-note')).to_contain_text('every day', timeout=8000)
    pg.click('[data-a=wa-preview]'); expect(pg.locator('.wa-prev')).to_contain_text('Glow Salon', timeout=8000); ok('WhatsApp opt-in saved with consent; preview')
    for r in ['dashboard', 'staff', 'attendance', 'shifts', 'leave', 'reports', 'ai', 'settings', 'plans', 'help']:
        pg.goto(BASE + '/staff360/app/#/' + r); pg.wait_for_timeout(300)
        assert 'Something went wrong' not in pg.inner_text('#s360-main'), r
    pg.set_viewport_size({'width': 390, 'height': 844})
    for r in ['dashboard', 'staff', 'attendance', 'ai']:
        pg.goto(BASE + '/staff360/app/#/' + r); pg.wait_for_timeout(300); assert overflow(pg) <= 0, r
    ok('All screens render on live data, no mobile overflow')
    pg.click('[data-a="pop:me"]'); pg.click('[data-a=signout]'); pg.wait_for_url('**/staff360/login/**', timeout=8000); ok('Owner log out')
    ctx.close()

    # 4) Manager can't change settings
    ctx, pg = page_for(b); login(pg, '9222222222'); pg.wait_for_timeout(500)
    if pg.locator('#boot .pick').count(): pg.locator('#boot .pick', has_text='Glow Salon').click()
    expect(pg.locator('#s360v2 .page-h h1')).to_be_visible(timeout=10000)
    pg.goto(BASE + '/staff360/app/#/settings'); expect(pg.locator('#s360-main')).to_contain_text('Only the owner'); ok('Manager: settings are owner-only')
    ctx.close()
    b.close()

errs = [e for e in errors if 'ERR_' not in e]
print(len(passed), 'passed; errors:', errs)
