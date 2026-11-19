from playwright.sync_api import sync_playwright, expect
import re
import os
B=os.environ.get('BASE','http://localhost:8098')+'/staff360/v2/'
P=0
def ok(m):
  global P; P+=1; print('PASS',m)
with sync_playwright() as p:
  b=p.chromium.launch(); errs=[]
  ctx=b.new_context(viewport={'width':1440,'height':900}, accept_downloads=True)
  pg=ctx.new_page(); pg.on('pageerror',lambda e: errs.append('desk:'+str(e)))
  pg.on('console',lambda m: errs.append('desk-console:'+m.text) if m.type=='error' and 'TUNNEL' not in m.text and 'Failed to load resource' not in m.text else None)
  pg.goto(B+'index.html'); pg.evaluate('localStorage.clear()'); pg.goto(B+'index.html#/dashboard'); pg.reload()
  # every route renders without overflow
  for r in ['dashboard','staff','staff/HN001','attendance','shifts','leave','reports','ai','settings','plans','help']:
    pg.goto(B+'index.html#/'+r); pg.wait_for_timeout(150)
    assert 'Something went wrong' not in pg.inner_text('main'), r
    assert pg.evaluate('document.documentElement.scrollWidth-innerWidth')<=0, r
  ok('all 11 owner routes render, no overflow (desktop)')
  # staff add validation + success
  pg.goto(B+'index.html#/staff'); pg.click('button[data-a="staff-add"] >> nth=0')
  pg.click('#s360-modal button[type=submit]'); expect(pg.locator('[data-err=name]')).to_contain_text('full name'); expect(pg.locator('[data-err=mobile]')).not_to_be_empty(); ok('add employee validates')
  pg.fill('#m-name','Ravi Prakash'); pg.fill('#m-mobile','9876543211'); pg.fill('#m-desig','Helper'); pg.click('#s360-modal button[type=submit]')
  expect(pg.locator('[data-err=mobile]')).to_contain_text('Pooja'); ok('duplicate mobile blocked')
  pg.fill('#m-mobile','9123456789'); pg.fill('#m-salary','12000'); pg.click('#s360-modal button[type=submit]')
  expect(pg).to_have_url(re.compile('#/staff/HN016')); expect(pg.locator('.prof-h h1')).to_contain_text('Ravi Prakash'); ok('employee added → profile HN016')
  pg.click('button[data-a="ptab:activity"]'); expect(pg.locator('.timeline')).to_contain_text('Added employee'); ok('profile activity log')
  pg.click('.prof-h button[data-a^="staff-edit"]'); pg.fill('#m-desig','Senior Helper'); pg.click('#s360-modal button[type=submit]'); expect(pg.locator('.prof-h p')).to_contain_text('Senior Helper'); ok('edit employee')
  pg.click('.prof-h button[data-a^="staff-toggle"]'); pg.click('#s360-modal button[type=submit]'); expect(pg.locator('.prof-h h1')).to_contain_text('Inactive'); ok('deactivate with confirm')
  pg.goto(B+'index.html#/staff'); pg.fill('#f-sq','zzzz'); expect(pg.locator('.empty.big')).to_be_visible(); ok('staff empty state')
  pg.click('[data-a=staff-clear]'); pg.select_option('#f-sdesig','Delivery'); expect(pg.locator('tbody tr')).to_have_count(3); ok('designation filter')
  with pg.expect_download() as d: pg.click('[data-a=staff-export]')
  assert d.value.suggested_filename.startswith('staff-'); ok('staff CSV export')
  # attendance
  pg.goto(B+'index.html#/attendance'); expect(pg.locator('.chips')).to_be_visible()
  row=pg.locator('tbody tr', has_text='Pooja Sharma'); row.locator('[data-a^="att-edit"]').click()
  pg.check('#s360-modal input[value=halfday]', force=True); pg.click('#s360-modal button[type=submit]')
  expect(pg.locator('[data-err=remark]')).to_contain_text('reason'); ok('correction requires reason')
  pg.fill('#m-remark','Left at 2 pm for doctor'); pg.click('#s360-modal button[type=submit]')
  expect(pg.locator('tbody tr', has_text='Pooja Sharma')).to_contain_text('Half day'); ok('correct attendance updates row')
  pg.goto(B+'index.html#/staff/HN002'); pg.click('button[data-a="ptab:activity"]'); expect(pg.locator('.timeline')).to_contain_text('Reason: Left at 2 pm'); ok('old → new + reason in activity log')
  pg.goto(B+'index.html#/attendance'); pg.click('[data-a="att-day:-1"]'); pg.click('thead [data-a=att-selall]'); expect(pg.locator('.bulkbar')).to_be_visible()
  pg.click('.bulkbar [data-a="att-bulkset:present"]'); expect(pg.locator('.toast')).to_contain_text('marked Present'); ok('select-all bulk mark')
  pg.click('[data-a="att-view:calendar"]'); expect(pg.locator('.cal-d.today')).to_be_visible(); ok('calendar view')
  pg.select_option('#f-aemp','HN001'); pg.locator('.cal-d:not([disabled])').first.click(); expect(pg.locator('#s360-modal')).to_contain_text('Mark attendance'); pg.keyboard.press('Escape'); expect(pg.locator('#s360-modal')).to_have_count(0); ok('calendar day opens editor; Esc closes')
  pg.select_option('#f-aemp',''); pg.click('[data-a="att-view:list"]')
  pg.click('[data-a=att-bulk]'); pg.click('#s360-modal button[type=submit]'); expect(pg.locator('[data-err=sid]')).to_contain_text('at least one'); pg.check('#s360-modal [data-m=all]'); pg.click('#s360-modal button[type=submit]'); expect(pg.locator('#s360-modal')).to_have_count(0); expect(pg.locator('.toast')).to_contain_text('marked'); ok('bulk mark modal')
  # shifts
  pg.goto(B+'index.html#/shifts'); pg.click('[data-a=shift-new]'); pg.fill('#m-sn','Night'); pg.fill('#m-ss','22:00'); pg.fill('#m-se','06:00'); pg.click('#s360-modal button[type=submit]')
  expect(pg.locator('.shift-c', has_text='Night')).to_contain_text('Overnight'); ok('create overnight shift')
  pg.click('[data-a="shift-del:morning"]'); expect(pg.locator('.toast')).to_contain_text('Move them'); ok('delete blocked when staff assigned')
  pg.locator('.sched tbody tr', has_text='Amit Kumar').locator('.slot').first.click(); pg.select_option('#m-as',label='Night (10:00 PM–6:00 AM)'); pg.click('#s360-modal button[type=submit]')
  expect(pg.locator('.sched tbody tr', has_text='Amit Kumar')).to_contain_text('Night'); ok('assign shift from weekly calendar')
  # leave
  pg.goto(B+'index.html#/leave'); n0=pg.locator('.kpi', has_text='Pending').locator('b').inner_text()
  pg.locator('tbody tr', has_text='Sunita Jha').locator('[data-a^="leave-view"]').click(); pg.click('#s360-modal [data-m=approve]')
  expect(pg.locator('.kpi', has_text='Pending').locator('b')).to_have_text(str(int(n0)-1)); ok('approve from leave detail updates KPIs')
  pg.click('[data-a=leave-new]'); pg.fill('#m-lr','x'); pg.click('#s360-modal button[type=submit]'); expect(pg.locator('[data-err=reason]')).not_to_be_empty()
  pg.fill('#m-lr','Going home for Chhath'); pg.click('#s360-modal button[type=submit]'); expect(pg.locator('.toast')).to_contain_text('submitted'); ok('new leave request')
  # reports
  pg.goto(B+'index.html#/reports'); expect(pg.locator('svg.chart')).to_have_count(2); expect(pg.locator('.hbars')).to_have_count(2)
  with pg.expect_download() as d: pg.click('.page-h [data-a="rep-csv:daily"]')
  assert d.value.suggested_filename.startswith('attendance-daily'); ok('reports charts + daily CSV')
  pg.select_option('#f-rrange','last'); expect(pg.locator('.page-h p')).to_contain_text('October'); ok('report range filter')
  # AI
  pg.goto(B+'index.html#/ai'); pg.click('[data-a="ai-ask:1"]'); expect(pg.locator('.msg.ai')).to_contain_text('late', timeout=3000); ok('AI suggested question answers from data')
  pg.fill('#ai-in','how many available tomorrow'); pg.keyboard.press('Enter'); expect(pg.locator('.msg.ai').last).to_contain_text('available', timeout=3000); ok('AI free-text question')
  pg.fill('#sal-salary','25000'); pg.press('#sal-salary','Tab'); expect(pg.locator('.sal-out')).to_contain_text('25,000'); ok('salary estimator recalculates')
  pg.click('[data-a=sal-approve]'); pg.click('#s360-modal button[type=submit]'); expect(pg.locator('.ok-note')).to_contain_text('No payment'); ok('approve estimate (no payment)')
  # settings
  pg.goto(B+'index.html#/settings'); pg.fill('#s-bn','Kiran Super Mart'); pg.click('form[data-set=business] button[type=submit]'); expect(pg.locator('.shop-a')).to_contain_text('Kiran Super Mart'); ok('settings save updates shell')
  # gating
  pg.goto(B+'index.html#/plans'); pg.click('[data-a="plan:basic"] >> nth=-1')
  for r,t in [('shifts','Premium'),('leave','Premium'),('ai','King PRO')]:
    pg.goto(B+'index.html#/'+r); expect(pg.locator('main h1')).to_contain_text('is on '+t)
  ok('Basic locks shifts, leave (Premium) and AI (King PRO)')
  pg.goto(B+'index.html#/reports'); expect(pg.locator('main')).to_contain_text('on Premium'); ok('Basic reports: advanced charts locked')
  pg.goto(B+'employee.html'); expect(pg.locator('.warn')).to_contain_text('Premium feature'); ok('employee portal gated on Basic')
  pg.evaluate("localStorage.setItem('s360v2.plan','premium')")
  # employee portal (mobile)
  m=ctx.new_page(); m.set_viewport_size({'width':390,'height':844}); m.on('pageerror',lambda e: errs.append('emp:'+str(e)))
  m.goto(B+'employee.html#/login'); m.fill('#e-mobile','9999999999'); m.click('#emp-login button[type=submit]'); expect(m.locator('[data-err=mobile]')).to_contain_text('isn’t registered'); ok('employee unknown number')
  m.fill('#e-mobile','9876543213'); m.click('#emp-login button[type=submit]'); expect(m.locator('#e-otp')).to_be_visible()
  m.fill('#e-otp','111111'); m.click('#emp-otp button[type=submit]'); expect(m.locator('[data-err=otp]')).to_contain_text('123456'); ok('wrong OTP rejected')
  m.fill('#e-otp','123456'); m.click('#emp-otp button[type=submit]'); expect(m.locator('.emp-hello')).to_contain_text('Sunita'); ok('mock OTP login')
  m.click('[data-e="punch:in"]'); expect(m.locator('.sheet')).to_contain_text('Getting your location'); expect(m.locator('.sheet')).to_contain_text('Location captured', timeout=3000)
  m.click('.sheet [data-e="sim:off"]'); expect(m.locator('.sheet')).to_contain_text('Location is off'); m.click('.sheet [data-e="sim:ok"]'); m.click('.sheet [data-e^="confirm"]')
  expect(m.locator('.emp-punch')).to_contain_text('Checked in'); expect(m.locator('.gps-ok')).to_contain_text('±15 m'); ok('simulated GPS check-in')
  m.screenshot(path='/tmp/emp-in.png')
  m.click('[data-e="punch:out"]'); expect(m.locator('.sheet')).to_contain_text('Location captured', timeout=3000); m.click('.sheet [data-e^="confirm"]'); expect(m.locator('.emp-punch')).to_contain_text('done for today'); ok('check-out')
  m.goto(B+'employee.html#/attendance'); expect(m.locator('.mini-cal .md.today i')).to_be_visible(); ok('my attendance calendar')
  m.goto(B+'employee.html#/leave'); m.click('[data-e=leave-new]'); m.fill('#m-lr','Sister wedding'); m.click('#s360-modal button[type=submit]'); expect(m.locator('.list')).to_contain_text('Pending'); ok('employee leave request')
  m.goto(B+'employee.html#/profile'); m.fill('#e-email','bad'); m.click('#emp-prof button[type=submit]'); expect(m.locator('[data-err=email]')).not_to_be_empty(); m.fill('#e-email','sunita@example.com'); m.click('#emp-prof button[type=submit]'); expect(m.locator('.toast')).to_contain_text('saved'); ok('profile edit permitted fields')
  assert m.evaluate('document.documentElement.scrollWidth-innerWidth')<=0
  # owner sees employee actions
  pg.goto(B+'index.html#/attendance'); pg.reload(); expect(pg.locator('tbody tr', has_text='Sunita Jha')).to_contain_text(re.compile('Late|Present')); ok('owner register shows employee check-in (shared demo store)')
  pg.goto(B+'index.html#/leave'); expect(pg.locator('tbody')).to_contain_text('Sister wedding'); ok('owner sees employee leave request')
  # mobile owner routes
  mo=ctx.new_page(); mo.set_viewport_size({'width':390,'height':844}); mo.on('pageerror',lambda e: errs.append('mob:'+str(e)))
  bad=[]
  for r in ['dashboard','staff','staff/HN002','attendance','shifts','leave','reports','ai','settings','plans','help']:
    mo.goto(B+'index.html#/'+r); mo.wait_for_timeout(120)
    ov=mo.evaluate('document.documentElement.scrollWidth-innerWidth')
    if ov>0: bad.append((r,ov))
  print('mobile overflow',bad); assert not bad; ok('all owner routes fit 390px')
  # round 2 (sample data): corrections, no-shows, shop location, WhatsApp
  r2=ctx.new_page(); r2.on('pageerror',lambda e: errs.append('r2:'+str(e)))
  r2.goto(B+'index.html#/leave/corrections'); r2.evaluate("localStorage.setItem('s360v2.plan','kingpro')"); r2.reload()
  row=r2.locator('tbody tr', has_text='Deepak'); expect(row).to_contain_text('In 9:05 AM'); row.locator('button.ok').click()
  expect(r2.locator('tbody tr', has_text='Deepak')).to_contain_text('Approved'); ok('owner approves a correction (sample)')
  r2.goto(B+'index.html#/attendance'); r2.click('[data-a="att-day:-1"]'); r2.click('[data-a=att-noshow]')
  if r2.locator('#s360-modal').count(): r2.click('#s360-modal button[type=submit]')
  expect(r2.locator('.toast')).to_be_visible(); ok('mark no-shows (sample)')
  r2.goto(B+'index.html#/settings'); r2.fill('#s-glat','28.6'); r2.fill('#s-glng','77.3'); r2.select_option('#s-gmode','flag'); r2.click('form[data-set=fence] button[type=submit]')
  expect(r2.locator('.toast')).to_contain_text('Shop location saved'); ok('shop location saves (sample)')
  r2.fill('#s-war','9876500000'); r2.check('form[data-set=wa] input[name=consent]'); r2.click('form[data-set=wa] button[type=submit]')
  expect(r2.locator('form[data-set=wa] .ok-note')).to_contain_text('every day'); r2.click('[data-a=wa-preview]'); expect(r2.locator('.wa-prev')).to_be_visible(); ok('WhatsApp opt-in (sample)')
  print(P,'passed; page errors:',errs)
  b.close()
