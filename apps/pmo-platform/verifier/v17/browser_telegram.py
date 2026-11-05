from pathlib import Path
import json
import os
import socket
import subprocess
import time
from playwright.sync_api import sync_playwright

ROOT = Path('/mnt/agents/output/app')
OUT = ROOT / 'verifier/v17'
BASE = 'http://localhost:3000'
TASK_ID = 'P-D-TG-978100001'
DECISION_ID = 'D-TG-978100001'
auth = json.loads(Path('/tmp/p0-test-auth.json').read_text())
env = os.environ.copy(); env['NODE_ENV'] = 'production'
log = open(OUT / 'browser-production-server.log', 'w')
app = subprocess.Popen(['node', 'dist/boot.js'], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
results = {'js_errors': [], 'local_404': []}
try:
    for _ in range(80):
        if app.poll() is not None:
            raise RuntimeError('production server exited')
        try:
            with socket.create_connection(('127.0.0.1', 3000), timeout=0.3):
                break
        except OSError:
            time.sleep(0.25)
    else:
        raise RuntimeError('production server did not start')

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        def context_for(who, viewport=None):
            context = browser.new_context(viewport=viewport or {'width': 1440, 'height': 1000})
            context.add_cookies([{'name': 'kimi_sid', 'value': auth[who]['token'], 'domain': 'localhost', 'path': '/', 'httpOnly': True}])
            return context
        def watch(page):
            page.on('pageerror', lambda exc: results['js_errors'].append(str(exc)))
            page.on('response', lambda r: results['local_404'].append(r.url) if r.status == 404 and r.url.startswith(BASE) else None)

        admin = context_for('rp')
        page = admin.new_page(); watch(page)
        page.goto(BASE + '/workspace.html', wait_until='networkidle')
        page.wait_for_function('SERVER_READY === true')
        page.wait_for_function("document.getElementById('telegramStatusText').textContent.includes('не настроен')")
        assert page.evaluate('USER_ROLE') == 'rp'
        results['honest_unconfigured_status'] = page.locator('#telegramStatusText').text_content()
        page.evaluate('openSettings()')
        page.screenshot(path=str(OUT / 'desktop-telegram-unconfigured.png'), full_page=True)
        page.evaluate('closeSettings()')

        page.evaluate('tasksCard()')
        row = page.locator('tr', has_text=TASK_ID).first
        row.wait_for()
        assert 'Результат:' in row.text_content()
        assert 'Тестирование перенесено на 02.10' in row.text_content()
        assert 'Участник' in row.text_content()
        results['result_visible_in_task_registry'] = True
        page.screenshot(path=str(OUT / 'desktop-task-result.png'), full_page=True)

        page.evaluate('decisionsCard()')
        decision = page.locator('tr', has_text=DECISION_ID).first
        decision.click()
        assert TASK_ID in page.locator('#docView').text_content()
        page.get_by_text('Серверный журнал событий', exact=False).click()
        journal = page.locator('#docView').text_content()
        for label in ['сигнал получен', 'риск зафиксирован', 'предложение создано', 'решение принято', 'поручение создано', 'результат сохранён']:
            assert label in journal, label
        results['full_chain_visible_in_audit'] = True
        page.screenshot(path=str(OUT / 'desktop-telegram-audit.png'), full_page=True)
        admin.close()

        member = context_for('member')
        page2 = member.new_page(); watch(page2)
        page2.goto(BASE + '/workspace.html', wait_until='networkidle')
        page2.wait_for_function('SERVER_READY === true')
        page2.wait_for_function("document.getElementById('telegramStatusText').textContent.includes('доступны РП')")
        assert page2.evaluate('canManage()') is False
        page2.evaluate('decisionsCard()')
        assert page2.locator('tr', has_text='D-01').first.get_by_title('Принять решение').count() == 0
        results['member_readonly_and_limited_status'] = True
        member.close()

        mobile = context_for('rp', {'width': 390, 'height': 844})
        page3 = mobile.new_page(); watch(page3)
        page3.goto(BASE + '/workspace.html', wait_until='networkidle')
        page3.wait_for_function('SERVER_READY === true')
        page3.evaluate('tasksCard()')
        page3.locator('tr', has_text=TASK_ID).first.wait_for()
        results['mobile_no_horizontal_overflow'] = page3.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        assert results['mobile_no_horizontal_overflow']
        page3.screenshot(path=str(OUT / 'mobile-task-result.png'), full_page=True)
        mobile.close()
        browser.close()

    assert not results['js_errors'], results['js_errors']
    assert not results['local_404'], results['local_404']
    results['all_checks_passed'] = True
    (OUT / 'browser-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps(results, ensure_ascii=False, indent=2))
finally:
    if app.poll() is None:
        app.terminate()
        try:
            app.wait(timeout=15)
        except subprocess.TimeoutExpired:
            app.kill(); app.wait(timeout=5)
    log.close()
