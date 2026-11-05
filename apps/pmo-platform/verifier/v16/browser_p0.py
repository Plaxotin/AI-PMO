from pathlib import Path
import json
from playwright.sync_api import sync_playwright

OUT = Path('/mnt/agents/output/app/verifier/v16')
AUTH = json.loads(Path('/tmp/p0-test-auth.json').read_text())
BASE = 'http://localhost:3000'
results = {}

def context_for(browser, who, viewport=None):
    context = browser.new_context(viewport=viewport or {'width': 1440, 'height': 1000})
    context.add_cookies([{'name': 'kimi_sid', 'value': AUTH[who]['token'], 'domain': 'localhost', 'path': '/', 'httpOnly': True}])
    return context

def watch(page, errors, not_found):
    page.on('pageerror', lambda exc: errors.append(str(exc)))
    page.on('response', lambda response: not_found.append(response.url) if response.status == 404 and response.url.startswith(BASE) else None)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    errors, not_found = [], []

    admin = context_for(browser, 'rp')
    page = admin.new_page(); watch(page, errors, not_found)
    page.goto(BASE + '/workspace.html', wait_until='networkidle')
    page.wait_for_function('SERVER_READY === true')
    assert page.evaluate('USER_ROLE') == 'rp'
    page.evaluate('decisionsCard()')
    page.locator('tr', has_text='D-02').first.wait_for()
    page.screenshot(path=str(OUT / 'desktop-decisions-before.png'), full_page=True)
    row = page.locator('tr', has_text='D-02').first
    row.get_by_title('Принять решение').click()
    page.wait_for_function("DECISIONS['PRJ-01'].find(x=>x.id==='D-02').st==='ok'")
    page.wait_for_function("TASKS['PRJ-01'].some(x=>x.id==='P-D-02'&&x.decisionId==='D-02')")
    page.wait_for_function("SERVER_EVENTS.some(x=>x.eventType==='decision.accepted'&&x.entityId==='D-02')&&SERVER_EVENTS.some(x=>x.eventType==='task.created'&&x.entityId==='P-D-02')")
    page.locator('tr', has_text='D-02').first.click()
    page.get_by_text('Серверный журнал событий', exact=False).click()
    page.screenshot(path=str(OUT / 'desktop-decisions-after.png'), full_page=True)
    results['admin_flow'] = page.evaluate("({role:USER_ROLE,decision:DECISIONS['PRJ-01'].find(x=>x.id==='D-02'),task:TASKS['PRJ-01'].find(x=>x.id==='P-D-02'),events:SERVER_EVENTS.filter(x=>x.entityId==='D-02'||x.entityId==='P-D-02').map(x=>x.eventType)})")
    admin.close()

    persisted = context_for(browser, 'rp')
    page2 = persisted.new_page(); watch(page2, errors, not_found)
    page2.goto(BASE + '/', wait_until='networkidle')
    page2.wait_for_url('**/workspace.html')
    page2.wait_for_function('SERVER_READY === true')
    assert page2.evaluate("DECISIONS['PRJ-01'].find(x=>x.id==='D-02').st") == 'ok'
    assert page2.evaluate("TASKS['PRJ-01'].some(x=>x.id==='P-D-02')")
    results['new_context_persistence'] = True
    persisted.close()

    member = context_for(browser, 'member')
    page3 = member.new_page(); watch(page3, errors, not_found)
    page3.goto(BASE + '/workspace.html', wait_until='networkidle')
    page3.wait_for_function('SERVER_READY === true')
    page3.evaluate('decisionsCard()')
    assert page3.evaluate('USER_ROLE') == 'member'
    assert page3.locator('tr', has_text='D-01').first.get_by_title('Принять решение').count() == 0
    assert page3.evaluate('canManage()') is False
    page3.screenshot(path=str(OUT / 'desktop-member-readonly.png'), full_page=True)
    results['member_readonly'] = True
    member.close()

    mobile = context_for(browser, 'rp', {'width': 390, 'height': 844})
    page4 = mobile.new_page(); watch(page4, errors, not_found)
    page4.goto(BASE + '/workspace.html', wait_until='networkidle')
    page4.wait_for_function('SERVER_READY === true')
    page4.evaluate('decisionsCard()')
    page4.screenshot(path=str(OUT / 'mobile-decisions.png'), full_page=True)
    results['mobile_no_horizontal_overflow'] = page4.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    assert results['mobile_no_horizontal_overflow']
    mobile.close()

    landing = browser.new_context(viewport={'width': 1440, 'height': 1000})
    page5 = landing.new_page(); watch(page5, errors, not_found)
    page5.goto(BASE + '/landing.html', wait_until='networkidle')
    assert page5.locator('[data-main-action]').count() == 2
    page5.screenshot(path=str(OUT / 'landing-desktop.png'), full_page=True)
    results['landing_unchanged_main_actions'] = True
    landing.close()

    anonymous = browser.new_context()
    page6 = anonymous.new_page(); watch(page6, errors, not_found)
    page6.goto(BASE + '/workspace.html', wait_until='networkidle')
    page6.wait_for_url('**/login')
    results['anonymous_redirected_to_login'] = True
    anonymous.close()
    browser.close()

results['js_errors'] = errors
results['local_404'] = not_found
assert not errors, errors
assert not not_found, not_found
(OUT / 'browser-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(json.dumps(results, ensure_ascii=False, indent=2))
