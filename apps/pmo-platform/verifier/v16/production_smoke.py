from pathlib import Path
import json
from playwright.sync_api import sync_playwright

out = Path('/mnt/agents/output/app/verifier/v16')
auth = json.loads(Path('/tmp/p0-test-auth.json').read_text())
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.add_cookies([{'name': 'kimi_sid', 'value': auth['rp']['token'], 'domain': 'localhost', 'path': '/', 'httpOnly': True}])
    page = context.new_page()
    errors, missing = [], []
    page.on('pageerror', lambda exc: errors.append(str(exc)))
    page.on('response', lambda r: missing.append(r.url) if r.status == 404 and r.url.startswith('http://localhost:3000') else None)
    page.goto('http://localhost:3000/workspace.html', wait_until='networkidle')
    page.wait_for_function('SERVER_READY === true')
    page.evaluate('decisionsCard()')
    assert page.evaluate("DECISIONS['PRJ-01'].find(x=>x.id==='D-02').st") == 'ok'
    assert page.evaluate("DECISIONS['PRJ-01'].find(x=>x.id==='D-01').st") == 'wait'
    assert page.evaluate("TASKS['PRJ-01'].filter(x=>x.decisionId==='D-02').length") == 1
    page.get_by_text('Серверный журнал событий', exact=False).click()
    page.screenshot(path=str(out / 'production-cold-start.png'), full_page=True)
    assert not errors, errors
    assert not missing, missing
    result = {'production_bundle': True, 'persistent_after_cold_start': True, 'one_linked_task': True, 'js_errors': errors, 'local_404': missing}
    (out / 'production-results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False))
    browser.close()
