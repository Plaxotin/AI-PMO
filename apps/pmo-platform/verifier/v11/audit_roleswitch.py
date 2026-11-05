#!/usr/bin/env python3
# verifier/v11 — как v10 (все 7 пунктов реализованы) + демо-переключатель роли смонтирован в шапки реестров.
import re, subprocess, tempfile, os, sys

APP = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
html = open(os.path.join(APP, 'index.html'), encoding='utf-8').read()
fails = []

def check(name, cond, detail=''):
    print(('PASS' if cond else 'FAIL'), '-', name, ('| ' + detail if detail else ''))
    if not cond:
        fails.append(name)

# Все проверки v10 (краткая форма)
check('п.1 кликабельный источник (srcBadgeHTML + srcPop)', 'function srcBadgeHTML' in html and 'Перейти →' in html)
check('п.2 бейджи каналов TG/почта/MAX/чат', all(k in html for k in ["tg:'TG'", "mail:'почта'", "max:'MAX'", "chat:'чат"]))
check('п.3 diff-паттерн P-08→P-04 18.09→22.09', "diff:{target:'P-04', field:'срок', from:'18.09', to:'22.09'}" in html and 'pend-diff' in html)
check('п.4 дедупликация P-09≈P-06 92% + объединить?', "dup:{of:'P-06', pct:92}" in html and 'объединить?' in html)
check('п.5 «Почему предлагает» + эффект', 'Почему предлагает:' in html and 'Эффект:' in html)
check('п.6 блокировка не-РП', "USER_ROLE!=='rp'" in html and 'Утверждать предложения может только РП' in html)
check('п.7 экран Решений не тронут', 'renderDecisionsView' in html and '${roleSwitchHTML()}' not in re.search(r'function renderDecisionsView.*?\n\}', html, re.S).group(0) if re.search(r'function renderDecisionsView.*?\n\}', html, re.S) else False)

# Новое в v11: переключатель роли смонтирован в Поручения/Риски/Стейкхолдеры, но не в Решения
check('roleSwitchHTML() смонтирован ровно в 3 реестрах', html.count('${roleSwitchHTML()}') == 3,
      f"found {html.count('${roleSwitchHTML()}')}")
check('переключатель в Поручениях', 'всего: ${list.length} · ${roleSwitchHTML()}' in html)
check('переключатель в Рисках', "активных (наступивших): ${list.filter(x=>x.prob==='активный').length} · ${roleSwitchHTML()}" in html)
check('переключатель в Стейкхолдерах', 'основа плана коммуникаций и реестра рисков · ${roleSwitchHTML()}' in html)
check('CSS .role-sw на месте', '.role-sw button.on{' in html)

# Целостность и синтаксис
check('HTML: один </html>', html.count('</html>') == 1)
scripts = re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>', html, re.S)
syn_ok = True
for s in scripts:
    if not s.strip():
        continue
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(s); path = f.name
    r = subprocess.run(['node', '--check', path], capture_output=True, text=True)
    if r.returncode != 0:
        syn_ok = False
        print(r.stderr[:1500])
    os.unlink(path)
check('JS: синтаксис', syn_ok)

print()
print('RESULT:', 'ALL PASS' if not fails else f'{len(fails)} FAILURES: {fails}')
sys.exit(1 if fails else 0)
