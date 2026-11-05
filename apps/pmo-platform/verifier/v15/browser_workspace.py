from pathlib import Path
import json, subprocess, time
from playwright.sync_api import sync_playwright

ROOT = Path('/mnt/agents/output/app')
OUT = ROOT / 'verifier/v15'
server = subprocess.Popen(['python3','-m','http.server','4174','--bind','127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
results = {'checks': [], 'errors': [], 'http404': []}
def check(name, condition):
    results['checks'].append({'name': name, 'ok': bool(condition)})
    if not condition:
        raise AssertionError(name)
try:
    time.sleep(.5)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        context = browser.new_context(viewport={'width':1440,'height':1000})
        page = context.new_page()
        page.on('pageerror', lambda e: results['errors'].append(str(e)))
        page.on('response', lambda r: results['http404'].append(r.url) if r.status == 404 and r.url.startswith('http://127.0.0.1:4174') else None)
        page.goto('http://127.0.0.1:4174/index.html', wait_until='domcontentloaded')
        page.wait_for_timeout(2800)
        check('audit-oriented welcome', 'Проверка, исправление и аудит проекта' in page.locator('#thread').inner_text())
        check('soon collapsed', 'open' not in (page.locator('#secSoon').get_attribute('class') or '').split())
        page.evaluate('decisionsCard()')
        page.locator('#docView .tk-table').wait_for()
        check('RP sees approval actions', page.locator('#docView .ai-act.ok').count() >= 2)
        page.locator('tr:has-text("D-02") .ai-act.ok').click()
        linked = page.evaluate('''() => {
          const d=DECISIONS['PRJ-01'].find(x=>x.id==='D-02');
          const t=TASKS['PRJ-01'].find(x=>x.decisionId==='D-02');
          return {decision:d, task:t, saved:JSON.parse(localStorage.getItem('aiPmoDemoState.v1')||'null')};
        }''')
        check('decision accepted', linked['decision']['st'] == 'ok')
        check('linked task really exists', linked['task'] and linked['task']['id'] == 'P-D-02')
        check('task preserves source and attribution', 'решение D-02' in linked['task']['src'] and 'Пиэмка от имени' in linked['task']['src'])
        check('demo state saved in browser', linked['saved'] and any(x.get('decisionId') == 'D-02' for x in linked['saved']['TASKS']['PRJ-01']))
        page.screenshot(path=str(OUT/'workspace-decision-accepted.png'), full_page=True)
        page.evaluate('tasksCard()')
        page.wait_for_timeout(1200)
        task_row = page.locator('#docView tr:has-text("P-D-02")')
        check('task visible in L4 registry', task_row.count() == 1)
        row_text = task_row.inner_text()
        check('task shows owner due source status', all(x in row_text for x in ['Давыдова Е.','22.09','решение D-02','новое']))
        page.reload(wait_until='domcontentloaded')
        page.evaluate('tasksCard()')
        page.wait_for_timeout(1200)
        check('linked task survives reload', page.evaluate("TASKS['PRJ-01'].some(x=>x.decisionId==='D-02')"))
        check('task still visible after reload', page.locator('#docView tr:has-text("P-D-02")').count() == 1)
        page.evaluate('decisionsCard()')
        page.evaluate("setRole('member')")
        check('member has no approval buttons', page.locator('#docView .ai-act.ok').count() == 0 and page.locator('#docView .ai-act.no').count() == 0)
        before = page.evaluate("({st:DECISIONS['PRJ-01'].find(x=>x.id==='D-01').st,n:TASKS['PRJ-01'].filter(x=>x.decisionId==='D-01').length})")
        page.evaluate("decAct('PRJ-01','D-01','ok')")
        after = page.evaluate("({st:DECISIONS['PRJ-01'].find(x=>x.id==='D-01').st,n:TASKS['PRJ-01'].filter(x=>x.decisionId==='D-01').length})")
        check('direct member action blocked', before == after)
        page.screenshot(path=str(OUT/'workspace-member-readonly.png'), full_page=True)
        page.evaluate('openSettings()')
        check('channels honestly disconnected', 'не подключено' in page.locator('#setPopBack').inner_text())
        page.evaluate("toggleChannel('Email')")
        check('channel click does not connect', page.evaluate("CHANNELS.Email === false") and 'не подключён' in page.locator('#toast').inner_text())
        page.evaluate("closeSettings();tasksCard();document.getElementById('toast').classList.remove('show')")
        page.set_viewport_size({'width':390,'height':844})
        page.wait_for_timeout(500)
        check('mobile page has no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
        mobile_row = page.locator('#docView tr:has-text("P-D-02")')
        labels = mobile_row.locator('td').evaluate_all('(cells)=>cells.map(c=>c.dataset.label)')
        check('mobile labels preserve all fields', all(x in labels for x in ['Срок','Источник','Статус']))
        check('mobile registry uses cards', mobile_row.evaluate("getComputedStyle(document.querySelector('#docView .tk-table thead')).display === 'none'"))
        check('mobile pending actions remain available', page.locator('#docView .pend-acts .ai-act').first.is_visible())
        page.screenshot(path=str(OUT/'workspace-mobile-tasks.png'), full_page=True)
        check('no javascript errors', not results['errors'])
        check('no local 404', not results['http404'])
        browser.close()
finally:
    server.terminate(); server.wait(timeout=5)
    (OUT/'browser-workspace-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(json.dumps(results, ensure_ascii=False, indent=2))
