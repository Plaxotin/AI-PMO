from pathlib import Path
import json, subprocess, time
from playwright.sync_api import sync_playwright

ROOT = Path('/mnt/agents/output/app')
OUT = ROOT / 'verifier/v15'
server = subprocess.Popen(['python3','-m','http.server','4173','--bind','127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
results = {'checks': [], 'errors': [], 'http404': []}
def check(name, condition):
    results['checks'].append({'name': name, 'ok': bool(condition)})
    if not condition:
        raise AssertionError(name)
try:
    time.sleep(.5)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width':1440,'height':1000}, device_scale_factor=1)
        page.on('pageerror', lambda e: results['errors'].append(str(e)))
        page.on('response', lambda r: results['http404'].append(r.url) if r.status == 404 and r.url.startswith('http://127.0.0.1:4173') else None)
        page.goto('http://127.0.0.1:4173/landing.html', wait_until='domcontentloaded')
        page.screenshot(path=str(OUT/'landing-desktop-before.png'), full_page=True)
        check('exactly two main actions', page.locator('[data-main-action]').count() == 2)
        check('no separate risk confirmation', page.locator('[data-act="confirm"]').count() == 0)
        page.locator('[data-act="open"]').click()
        page.locator('#bub2').wait_for(state='visible')
        check('risk fixed automatically', 'зафиксирован автоматически' in page.locator('#bub2').inner_text())
        check('proposal visible after first click', 'Предложение:' in page.locator('#bub2').inner_text())
        page.locator('[data-act="source"]').click()
        check('source evidence opens', page.locator('#sourceQuote').is_visible() and 'Пиэмка · автоматически' in page.locator('#sourceQuote').inner_text())
        page.locator('[data-act="accept"]').click()
        page.locator('#bub3').wait_for(state='visible')
        result = page.locator('#bub3').inner_text()
        check('decision and assignment created', 'D-207' in result and 'P-D-207' in result)
        check('human attribution preserved', 'Пиэмка от имени Плахотина К.' in result)
        check('result links to workspace audit', page.locator('#bub3 a[href="index.html"]').count() == 1)
        check('no step 3 copy', 'Шаг 3' not in page.locator('body').inner_text())
        page.screenshot(path=str(OUT/'landing-desktop-result.png'), full_page=True)
        mobile = browser.new_page(viewport={'width':390,'height':844}, device_scale_factor=1)
        mobile.on('pageerror', lambda e: results['errors'].append(str(e)))
        mobile.goto('http://127.0.0.1:4173/landing.html', wait_until='domcontentloaded')
        check('mobile has no page overflow', mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
        mobile.locator('[data-act="open"]').click()
        mobile.locator('#bub2').wait_for(state='visible')
        mobile.locator('[data-act="accept"]').click()
        mobile.locator('#bub3').wait_for(state='visible')
        check('mobile two-click result visible', mobile.locator('#bub3').is_visible())
        mobile.screenshot(path=str(OUT/'landing-mobile-result.png'), full_page=True)
        check('no javascript errors', not results['errors'])
        check('no local 404', not results['http404'])
        browser.close()
finally:
    server.terminate(); server.wait(timeout=5)
    (OUT/'browser-landing-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(json.dumps(results, ensure_ascii=False, indent=2))
