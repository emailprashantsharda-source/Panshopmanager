"""Staff360 plans + PayU checkout from the screens (QA server stands in for PayU; the real
PayU code is tested in test/payu.test.js).
  node functions-staff360/qa/server.js &   python3 functions-staff360/qa/billing_v2_test.py"""
import os, urllib.request
from playwright.sync_api import sync_playwright, expect
BASE = os.environ.get('QA_BASE', 'http://127.0.0.1:8360')
FB = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mock-firebase')
OUT = os.environ.get('QA_OUT', '/tmp/s360bill'); os.makedirs(OUT, exist_ok=True)
passed, errors = [], []
def ok(n): passed.append(n); print('PASS', n)
def ctl(p): urllib.request.urlopen(BASE + p).read()
PHONE = {'owner': '+919000000001', 'manager': '+919222222222'}

def page_for(b, role, w=1280, h=900):
    ctx = b.new_context(viewport={'width': w, 'height': h})
    ctx.route('https://www.gstatic.com/firebasejs/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=open(os.path.join(FB, r.request.url.split('/')[-1].split('?')[0])).read()))
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
    ctx.add_init_script(f"try{{localStorage.setItem('mock_user','{role}');localStorage.setItem('mock_phone','{PHONE[role]}')}}catch(e){{}}")
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    pg.on('console', lambda m: errors.append(f'console: {m.text}') if m.type == 'error' and 'favicon' not in m.text else None)
    return ctx, pg

with sync_playwright() as p:
    b = p.chromium.launch(); ctl('/__reset')
    ctx, pg = page_for(b, 'owner')
    pg.goto(f'{BASE}/staff360/v2/app.html?t=A&n=Glow%20Salon#/plans')
    expect(pg.locator('.plan-c.basic .price')).to_contain_text('Free', timeout=12000)
    expect(pg.locator('.plan-c.premium .price')).to_contain_text('₹999'); expect(pg.locator('.plan-c.premium .price')).to_contain_text('month')
    expect(pg.locator('.plan-c.kingpro .price')).to_contain_text('₹4,999'); expect(pg.locator('.plan-c.kingpro .price')).to_contain_text('year')
    expect(pg.locator('.plan-c.premium .plan-lim')).to_contain_text('Up to 10 staff with phone login'); expect(pg.locator('.plan-c.kingpro .plan-lim')).to_contain_text('Unlimited')
    pg.screenshot(path=f'{OUT}/01-plans-basic.png', full_page=True); ok('Plans show Free / ₹999 a month / ₹4,999 a year and staff limits')

    pg.click('[data-a="buy:premium"]')
    expect(pg.locator('.toast')).to_contain_text('Payment received', timeout=12000)
    assert 'payu=' not in pg.url, pg.url
    expect(pg.locator('.plan-c.premium')).to_contain_text('Your plan', timeout=8000)
    expect(pg.locator('.page-h')).to_contain_text('Premium active till')
    expect(pg.locator('[data-a="buy:premium"]')).to_contain_text('Renew — Pay ₹999')
    expect(pg.locator('.plan-c.kingpro')).to_contain_text('Unused Premium days are added')
    pg.screenshot(path=f'{OUT}/02-paid-premium.png', full_page=True); ok('Pay ₹999 → back on Staff360, Premium on, renew + upgrade offered')

    pg.click('[data-a="buy:kingpro"]')
    expect(pg.locator('.toast')).to_contain_text('Payment received', timeout=12000)
    expect(pg.locator('.plan-c.kingpro')).to_contain_text('Your plan', timeout=8000)
    expect(pg.locator('.plan-c.premium button')).to_contain_text('Included in King PRO'); ok('Upgrade to King PRO; Premium can’t be bought on top')
    pg.goto(f'{BASE}/staff360/v2/app.html?t=A&n=Glow%20Salon#/settings')
    expect(pg.locator('.card', has_text='Subscription')).to_contain_text('King PRO active till', timeout=10000); ok('Settings shows the plan end date')
    ctx.close()

    ctx, pg = page_for(b, 'manager')
    pg.goto(f'{BASE}/staff360/v2/app.html?t=A&n=Glow%20Salon#/plans')
    expect(pg.locator('.plan-c.kingpro button')).to_contain_text('Only the owner can renew', timeout=12000); assert pg.locator('[data-a^="buy:"]').count() == 0; ok('Managers can’t pay')
    ctx.close()

    # Failed payment: plan unchanged, clear message
    ctl('/__reset'); ctx, pg = page_for(b, 'owner')
    pg.goto(f'{BASE}/staff360/v2/app.html?t=A&n=Glow%20Salon&payu=failed&txnid=X#/plans')
    expect(pg.locator('.toast')).to_contain_text('didn’t go through', timeout=12000); expect(pg.locator('.plan-c.basic')).to_contain_text('Your plan'); ok('Failed payment message; still Basic')
    ctx.close(); b.close()
errs = [e for e in errors if 'ERR_' not in e]
print(len(passed), 'passed; errors:', errs)
