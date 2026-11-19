"""Staff360 v2 inside the HisaabNow app (app.hisaabnow.com): the app's Staff360 button opens
the new screens in a frame, using the app's own sign-in, against the REAL handlers.
  node functions-staff360/qa/server.js &   python3 functions-staff360/qa/inapp_v2_test.py"""
import os, urllib.request
from playwright.sync_api import sync_playwright, expect
BASE = os.environ.get('QA_BASE', 'http://127.0.0.1:8360')
FB = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mock-firebase')
OUT = os.environ.get('QA_OUT', '/tmp/s360inapp'); os.makedirs(OUT, exist_ok=True)
passed, errors = [], []
def ok(n): passed.append(n); print('PASS', n)
def ctl(p): urllib.request.urlopen(BASE + p).read()
PHONE = {'owner': '+919000000001', 'employee': '+919111111111', 'manager': '+919222222222'}

def page_for(b, role, w=1440, h=900, geo=None):
    ctx = b.new_context(viewport={'width': w, 'height': h}, geolocation=geo, permissions=['geolocation'] if geo else [])
    ctx.route('https://www.gstatic.com/firebasejs/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=open(os.path.join(FB, r.request.url.split('/')[-1].split('?')[0])).read()))
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
    ctx.add_init_script(f"try{{localStorage.setItem('mock_user','{role}');localStorage.setItem('mock_phone','{PHONE[role]}')}}catch(e){{}}")
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    pg.on('console', lambda m: errors.append(f'console: {m.text}') if m.type == 'error' and 'favicon' not in m.text else None)
    pg.goto(f'{BASE}/qa?role={role}'); pg.wait_for_function('window.Staff360 && window.HNAttend')
    return ctx, pg

with sync_playwright() as p:
    b = p.chromium.launch(); ctl('/__reset'); ctl('/__plan?p=premium')
    ctx, pg = page_for(b, 'owner')
    pg.evaluate("Staff360.open('overview')")
    fr = pg.frame_locator('#s360v2-frame iframe')
    expect(fr.locator('#s360v2 .page-h h1')).to_be_visible(timeout=12000)
    expect(fr.locator('.kpi', has_text='Total Staff').locator('b')).to_have_text('4'); ok('App button opens the new dashboard with the shop’s staff')
    expect(fr.locator('.back-hn')).to_be_visible(); assert fr.locator('.demo-plans').count() == 0
    pg.screenshot(path=f'{OUT}/01-inapp-dashboard.png')
    fr.locator('a.nav-i[href="#/attendance"]').click()
    fr.locator('tbody tr', has_text='Vikas Singh').locator('[data-a^="att-quick"]', has_text='Absent').click()
    pg.wait_for_timeout(1200)
    fr.locator('a.nav-i[href="#/staff"]').click(); fr.locator('a.nav-i[href="#/attendance"]').click()
    expect(fr.locator('tbody tr', has_text='Vikas Singh')).to_contain_text('Absent', timeout=8000); ok('Marking from inside the app saves to the shared register')
    fr.locator('.back-hn').click(); expect(pg.locator('#s360v2-frame')).to_have_count(0); ok('“HisaabNow” button closes Staff360 and returns to the app')
    pg.evaluate("Staff360.open('register')"); expect(pg.frame_locator('#s360v2-frame iframe').locator('#s360v2 h1')).to_contain_text('Attendance Register', timeout=12000); ok('Opening a section goes straight to it')
    ctx.close()

    # Employee (HisaabNow staff login) gets the phone check-in screen inside the app
    ctx, pg = page_for(b, 'employee', 390, 844, geo={'latitude': 28.5355, 'longitude': 77.391, 'accuracy': 20})
    pg.evaluate("Staff360.open()")
    fr = pg.frame_locator('#s360v2-frame iframe')
    expect(fr.locator('#s360emp .emp-hello')).to_contain_text('Amit', timeout=12000)
    fr.locator('[data-e="punch:in"]').click(); expect(fr.locator('.sheet')).to_contain_text('Location captured', timeout=8000)
    fr.locator('.sheet [data-e^="confirm"]').click(); expect(fr.locator('.emp-punch')).to_contain_text('Checked in', timeout=8000); ok('Employee checks in from inside the app')
    pg.screenshot(path=f'{OUT}/02-inapp-employee.png')
    fr.locator('.emp-top [data-e=logout]').click(); expect(pg.locator('#s360v2-frame')).to_have_count(0); ok('Employee back button returns to the app')
    ctx.close()

    # Old screen still available as a fallback
    ctx, pg = page_for(b, 'owner')
    pg.evaluate("localStorage.setItem('HN_S360_UI','old'); Staff360.open('overview')")
    expect(pg.locator('#s360')).to_be_visible(timeout=8000); assert pg.locator('#s360v2-frame').count() == 0; ok('Fallback: older screen still opens when switched back')
    ctx.close(); b.close()
errs = [e for e in errors if 'ERR_' not in e]
print(len(passed), 'passed; errors:', errs)
