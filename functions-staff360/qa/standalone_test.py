"""Standalone Staff360 (hisaabnow.com/staff360/login + /app) end-to-end test.
Firebase is replaced by qa/mock-firebase (OTP 123456); Cloud Functions are the
real handlers via qa/server.js.  Run:
  SITE_ROOT=/path/to/dukaanai node functions-staff360/qa/server.js &
  python3 functions-staff360/qa/standalone_test.py"""
import os, sys, json, urllib.request
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('QA_BASE', 'http://127.0.0.1:8360')
OUT = os.environ.get('QA_OUT', '/tmp/s360sa')
os.makedirs(OUT, exist_ok=True)
passed, errors = [], []
def ok(n): passed.append(n); print('PASS', n)
def ctl(p): urllib.request.urlopen(BASE + p).read()

def page_for(b, w=390, h=844, geo=None):
    ctx = b.new_context(viewport={'width': w, 'height': h}, geolocation=geo, permissions=['geolocation'] if geo else [])
    ctx.route('https://www.gstatic.com/firebasejs/**', lambda r: r.fulfill(status=200, content_type='text/javascript',
        body=open(os.path.join(os.path.dirname(__file__), 'mock-firebase', r.request.url.split('/')[-1].split('?')[0])).read()))
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    pg.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)
    return ctx, pg

def login(pg, phone):
    pg.goto(BASE + '/staff360/login/')
    pg.fill('#phone', phone); pg.click('#send')
    expect(pg.locator('#f-otp')).to_be_visible()
    pg.fill('#otp', '123456')
    pg.wait_for_url('**/staff360/app/**', timeout=8000)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctl('/__reset')

    # Login page states
    ctx, pg = page_for(b, 1280, 800)
    pg.goto(BASE + '/staff360/login/'); pg.wait_for_timeout(400)
    pg.screenshot(path=f'{OUT}/01-login-desktop.png')
    pg.fill('#phone', '12345'); pg.click('#send'); expect(pg.locator('#e1')).to_contain_text('10-digit'); ok('Login: rejects a bad number')
    pg.fill('#phone', '9800000001'); pg.click('#send'); expect(pg.locator('#f-otp')).to_be_visible()
    pg.fill('#otp', '111111'); pg.click('#verify'); expect(pg.locator('#e2')).to_contain_text('not right'); ok('Login: wrong OTP shows an error')
    ctx.close()

    # New owner: sign up → own business, add staff, give login, mark attendance
    ctx, pg = page_for(b)
    login(pg, '9800000001')
    expect(pg.locator('#su')).to_be_visible(timeout=8000); pg.screenshot(path=f'{OUT}/02-signup.png'); ok('New user lands on business set-up')
    pg.fill('#su input[name=name]', 'Sharma Clinic'); pg.select_option('#su select[name=type]', 'clinic'); pg.click('#su button[type=submit]')
    expect(pg.locator('#s360 .s360-stat').first).to_be_visible(timeout=8000)
    expect(pg.locator('#s360-sub')).to_contain_text('Sharma Clinic'); expect(pg.locator('#s360-badge')).to_contain_text('BASIC')
    pg.screenshot(path=f'{OUT}/03-owner-overview-empty.png'); ok('Business created; hub opens on Basic with own branding')
    pg.click('#s360 button[data-a=addstaff] >> nth=0')
    expect(pg.locator('#s360-sheet form[data-f=staff]')).to_be_visible(timeout=8000)
    pg.fill('#s360-sheet input[name=name]', 'Ravi Kumar'); pg.fill('#s360-sheet input[name=role]', 'Receptionist'); pg.fill('#s360-sheet input[name=phone]', '9800000002')
    pg.check('#s360-sheet input[name=canLogin]'); pg.screenshot(path=f'{OUT}/04-add-staff.png'); pg.click('#s360-sheet button[type=submit]')
    expect(pg.locator('#s360-main')).to_contain_text('Ravi Kumar', timeout=8000)
    pg.click('#s360 button[data-a=addstaff] >> nth=0'); pg.fill('#s360-sheet input[name=name]', 'Neha Gupta'); pg.fill('#s360-sheet input[name=role]', 'Nurse'); pg.click('#s360-sheet button[type=submit]')
    expect(pg.locator('#s360-main')).to_contain_text('Neha Gupta', timeout=8000); pg.screenshot(path=f'{OUT}/05-team.png'); ok('Owner adds staff and grants a login')
    pg.click('#s360-nav button[data-v=register]'); pg.click('#s360-main button[data-a=mark]')
    expect(pg.locator('#s360-main')).to_contain_text('Mark attendance', timeout=8000)
    pg.click('#s360-main button[data-a=mkall]'); expect(pg.locator('#s360-main button[data-a=mk][aria-pressed=true]')).to_have_count(2, timeout=8000)
    pg.fill('#s360-mkreason', 'Came after lunch'); pg.locator('#s360-main .s360-row', has_text='Neha Gupta').locator('button[title=Half-day]').click()
    expect(pg.locator('#s360-main .s360-row', has_text='Neha Gupta').locator('button[aria-pressed=true]')).to_have_text('H', timeout=8000)
    pg.screenshot(path=f'{OUT}/06-mark.png'); ok('Owner marks everyone present, then changes one to Half-day')
    pg.click('#s360-nav button[data-v=overview]'); expect(pg.locator('#s360-main .s360-stat.p b')).to_have_text('2', timeout=8000); ok('Overview counts come from the server')
    pg.click('#s360-nav button[data-v=activity]'); expect(pg.locator('#s360-main')).to_contain_text('Present → Half-day', timeout=8000)
    expect(pg.locator('#s360-main')).to_contain_text('Came after lunch'); ok('Activity log: server-side old → new with reason')
    pg.click('#s360-nav button[data-v=reports]'); expect(pg.locator('#s360-main table')).to_contain_text('Neha Gupta', timeout=8000); ok('Basic report from the server')
    pg.click('#s360-nav button[data-v=shifts]'); expect(pg.locator('.s360-lock')).to_be_visible(); ok('Premium still locked on Basic')
    org = pg.evaluate("MShop.getActive().shopId"); assert org.startswith('s360_'), org
    pg.click('#s360 button[data-a=menu]'); expect(pg.locator('.menu')).to_contain_text('Log out'); pg.screenshot(path=f'{OUT}/07-menu.png')
    pg.click('.menu button[data-a=out]'); pg.wait_for_url('**/staff360/login/**', timeout=8000); ok('Log out returns to the login page')
    ctx.close()

    # Employee: logs in, sees My attendance; check-in needs Premium
    ctx, pg = page_for(b, geo={'latitude': 28.62, 'longitude': 77.37, 'accuracy': 14})
    login(pg, '9800000002')
    expect(pg.locator('#s360e')).to_be_visible(timeout=8000); expect(pg.locator('#s360e-main')).to_contain_text('Self check-in is available when the shop is on Staff360 Premium', timeout=8000)
    ok('Employee lands on My attendance; Basic shows no check-in')
    ctl(f'/__plan?p=premium&shop={org}')
    pg.reload(); expect(pg.locator('.s360e-big')).to_have_text('CHECK IN', timeout=10000)
    pg.click('.s360e-big'); expect(pg.locator('#s360e-main .s360-ok')).to_contain_text('Check-in recorded', timeout=8000)
    pg.screenshot(path=f'{OUT}/08-employee-checked-in.png'); ok('Premium: employee checks in with GPS from the standalone site')
    assert pg.evaluate("!document.querySelector('#s360')"), 'employee must not get the owner hub'
    ctx.close()

    # Owner sees the punch with GPS on the register
    ctx, pg = page_for(b, 1280, 860)
    login(pg, '9800000001')
    expect(pg.locator('#s360-badge')).to_contain_text('PREMIUM', timeout=8000)
    pg.click('#s360-nav button[data-v=register]'); expect(pg.locator('#s360-main table')).to_contain_text('± 14 m', timeout=8000)
    pg.screenshot(path=f'{OUT}/09-owner-register-desktop.png'); ok('Owner sees the check-in with GPS accuracy')
    ctx.close()

    # HisaabNow shop owner on the standalone site: same data
    ctx, pg = page_for(b)
    login(pg, '9000000001')
    expect(pg.locator('#s360-sub')).to_contain_text('Glow Salon', timeout=8000); ok('HisaabNow shop owner opens the same shop on the website')
    pg.click('#s360-nav button[data-v=team]'); expect(pg.locator('#s360-main')).to_contain_text('add or rename staff in the HisaabNow app', timeout=8000)
    pg.locator('#s360-main .s360-row', has_text='Riya Sharma').locator('button[data-a=editstaff]').click()
    expect(pg.locator('#s360-sheet input[name=name]')).to_be_disabled(); pg.check('#s360-sheet input[name=canLogin]'); pg.click('#s360-sheet button[type=submit]')
    expect(pg.locator('#s360-main .s360-row', has_text='Riya Sharma')).to_contain_text('Login', timeout=8000); ok('Shop owner gives a stylist (no app login) a Staff360 login')
    ctx.close()

    # Mobile widths: no sideways overflow
    for w in (320, 390):
        ctx, pg = page_for(b, w, 800)
        login(pg, '9800000001'); expect(pg.locator('#s360 .s360-stat').first).to_be_visible(timeout=8000)
        for v in ('overview', 'team', 'register', 'mark', 'reports', 'plans'):
            pg.evaluate(f"Staff360.open('{v}')"); pg.wait_for_timeout(500)
            sw = pg.evaluate("document.getElementById('s360').scrollWidth"); assert sw <= w + 1, (v, w, sw)
        pg.goto(BASE + '/staff360/login/'); sw = pg.evaluate('document.documentElement.scrollWidth'); assert sw <= w + 1
        ctx.close()
    ok('No sideways overflow at 320 / 390 px')
    b.close()

errs = [e for e in errors if 'favicon' not in e and 'hn-analytics' not in e]
print(f'\n{len(passed)} passed; console/page errors: {len(errs)}')
for e in errs: print('  ', e)
sys.exit(1 if errs else 0)
