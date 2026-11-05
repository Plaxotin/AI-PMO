#!/usr/bin/env python3
# verifier/v9 — удаление журнала проблем, логика «наступивший риск = вероятность "активный"»
import re, subprocess, tempfile, os, sys

APP = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
html = open(os.path.join(APP, 'index.html'), encoding='utf-8').read()
fails = []

def check(name, cond, detail=''):
    print(('PASS' if cond else 'FAIL'), '-', name, ('| ' + detail if detail else ''))
    if not cond:
        fails.append(name)

# 1. В сайдбаре нет пункта «Проблемы»
sidebar = re.search(r'<aside.*?</aside>', html, re.S).group(0)
check('sidebar: нет issuesCard', 'issuesCard' not in sidebar)
check('sidebar: нет пункта «Проблемы»', not re.search(r'nav-item[^>]*>\s*(<svg.*?</svg>\s*)?Проблемы', sidebar, re.S))

# 2. Механика issues удалена полностью
for token in ['issuesCard', 'renderIssuesView', 'ensureIssuesTab', 'const ISSUES',
              'ISS_ST', 'ISS_CLS', 'PROPS.issues', "kind==='issues'", 'pendRowsHTML(\'issues\'']:
    check(f'код: нет «{token}»', token not in html)

# 3. Не осталось ID проблем I-xxx
check('код: нет идентификаторов I-xxx', not re.search(r'\bI-\d{3}\b', html))

# 4. Каталог артефактов и палитра действий очищены
check('каталог: нет «Журнал проблем (issue log)»', 'Журнал проблем (issue log)' not in html)
check('палитра: нет «Проблемы — открыть журнал»', 'Проблемы — открыть журнал' not in html)

# 5. Статус «активный» в селектах вероятности (2 места: редактор риска + редактор предложения)
check('селекты вероятности содержат «активный» (x2)',
      html.count("['низкая','средняя','высокая','активный']") == 2)

# 6. Бейдж «активный» маппится на класс live в обеих таблицах
check('бейдж prob===активный → tk-st live (x2)',
      html.count("x.prob==='активный'?'live'") == 2)
check('CSS: класс .tk-st.live определён', '.tk-st.live{' in html)

# 7. Данные: наступившие риски в реестре рисков
risks_block = re.search(r'const RISKS = \{(.*?)\n\};', html, re.S).group(1)
n_active = risks_block.count("prob:'активный'")
check('RISKS: ≥3 записей с prob=активный (R-102, R-106, R-107)', n_active >= 3, f'found {n_active}')
for rid in ['R-102', 'R-106', 'R-107']:
    check(f'RISKS: {rid} присутствует', rid in risks_block)

# 8. Предложение I-005 мигрировано в риски как R-105 с prob=активный
props_risks = re.search(r'risks:\{\'PRJ-01\':\[(.*?)\],\'PRJ-02\'', html, re.S).group(1)
check('PROPS.risks: R-105 с prob=активный', "id:'R-105'" in props_risks and "prob:'активный'" in props_risks)

# 9. Тексты представления объясняют новую логику
check('view: мета со счётчиком активных', 'активных (наступивших)' in html)
check('view: пояснение логики «активный»', 'его вероятность меняется на «активный»' in html)

# 10. Перекрёстные ссылки обновлены
check('S-06: ссылка на риск R-102', '(риск R-102 · активный)' in html)
check('S-07 why: ссылка на риск R-107', 'у риска R-107 нет владельца' in html)

# 11. Бейдж источника «реестр»
check('CH_BADGE: канал reg', "reg:'реестр'" in html)
check('CSS: .ch-badge.ch-reg', '.ch-badge.ch-reg{' in html)

# 12. Целостность документа и синтаксис JS
check('HTML: ровно один </html>', html.count('</html>') == 1)
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
check('JS: синтаксис всех <script> блоков', syn_ok)

print()
print('RESULT:', 'ALL PASS' if not fails else f'{len(fails)} FAILURES: {fails}')
sys.exit(1 if fails else 0)
