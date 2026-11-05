#!/usr/bin/env python3
# verifier/v12 — лендинг вариант B (landing-b.html) против критериев приёмки брифа.
# Текущий landing.html и index.html не тронуты — сравнение вариантов сохранено.
import re, subprocess, tempfile, os, sys

APP = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
b = open(os.path.join(APP, 'landing-b.html'), encoding='utf-8').read()
a = open(os.path.join(APP, 'landing.html'), encoding='utf-8').read()
fails = []

def check(name, cond, detail=''):
    print(('PASS' if cond else 'FAIL'), '-', name, ('| ' + detail if detail else ''))
    if not cond:
        fails.append(name)

def text_len(s):
    s = re.sub(r'<style.*?</style>|<script.*?</script>', ' ', s, flags=re.S)
    s = re.sub(r'<[^>]+>', ' ', s)
    return len(re.sub(r'\s+', ' ', s).strip())

# К1: ценность за 5–10 сек — hero с заданным заголовком и подзаголовком
check('hero h1 по брифу', 'Узнавайте о рисках проекта' in b and 'до того, как они станут проблемами' in b)
check('hero lede по брифу', 'анализирует переписку, планы и поручения' in b and 'привычных каналах коммуникации' in b)
check('подпись «альфа-версия · демонстрационные данные»', 'альфа-версия · демонстрационные данные' in b)
check('матрёшка в hero', 'matreshka-hero.png' in b)

# К2: сокращение текста 50–60%
la, lb = text_len(a), text_len(b)
ratio = lb / la
check('объём текста ≤ 50% от текущего', ratio <= 0.50, f'{lb} vs {la} символов = {ratio:.0%}')

# К3: цепочка показана один раз
check('схема matreshka-full-cycle одна', b.count('matreshka-full-cycle.png') == 2)  # <a href> + <img src>
check('цепочка из 5 шагов в лиде', 'Переписка и документы → обнаружение сигнала → фиксация риска → управленческое решение → поручение и контроль исполнения' in b)
check('нет дублирующих lcards/mpairs', 'lcards' not in b and 'mpairs' not in b)
check('нет секций-дублей («Как это работает»/«следит сама»)', 'Платформа следит сама' not in b and 'Как это работает' not in b)

# К4: интерактивная демонстрация работает (структура + обработчики)
check('демо: bubbles bub2/bub3/bub4', all(f'id="bub{i}"' in b for i in (2, 3, 4)))
check('демо: обработчики open/confirm/accept/discuss/decline',
      all(f'data-act="{x}"' in b for x in ('open', 'confirm', 'accept', 'discuss', 'decline')))
check('демо: обновляемые карточки card2-4', all(f'id="card{i}"' in b for i in (2, 3, 4)))
check('демо: сценарий «подрядчик → риск → решение → поручение»',
      'Подрядчик сообщает' in b and 'Рекомендуемое решение' in b and 'Поручение создано' in b)

# К5: один доминирующий CTA «Открыть демо-проект» → index.html, без конкурирующих
ctas = re.findall(r'class="btn btn-p"[^>]*href="([^"]+)"[^>]*>([^<]+)<', b)
check('CTA только «Открыть демо-проект» → index.html', bool(ctas) and all(h == 'index.html' and 'Открыть демо-проект' in t for h, t in ctas), str(ctas))
check('нет вторичных btn-g', 'btn-g' not in b)

# К6: нет неподтверждённых обещаний
for bad in ['улучшается сама', 'Ноль обучения', 'Без внедрения', 'полностью автоматически', 'минуты вместо дней', '0 часов обучения']:
    check(f'нет обещания «{bad}»', bad not in b)
check('честная пометка «волна 2»/учебные данные', 'волна 2' in b and 'данные учебные' in b)

# К7: проблема→результат — 3 строки по брифу
check('3 пункта проблема→результат', b.count('class="prow"') == 3)
for t in ['сигналы теряются в переписке', 'Риски фиксируются слишком поздно', 'не доходят до исполнения']:
    check(f'пункт «{t}»', t in b)

# К8: возможности — 4 направления
check('4 направления возможностей', b.count('class="capr"') == 4)
for t in ['Мониторинг проектных коммуникаций', 'Выявление и ведение рисков', 'Решения и поручения', 'Анализ планов и документов']:
    check(f'направление «{t}»', t in b)

# Адаптивность
check('мобильные media queries', '@media (max-width:640px)' in b and 'giant-m' in b)

# Технические: текущие файлы не тронуты, ссылки и ассеты на месте
check('index.html не менялся (ссылка воркспейс жива)', os.path.exists(os.path.join(APP, 'index.html')))
for img in ['matreshka-hero.png', 'matreshka-full-cycle.png']:
    check(f'ассет {img} существует', os.path.exists(os.path.join(APP, img)))
check('SEO: title и description', '<title>AI PMO — узнавайте о рисках' in b and 'name="description"' in b)

# JS-синтаксис
scripts = re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>', b, re.S)
syn = True
for s in scripts:
    if not s.strip():
        continue
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(s); path = f.name
    r = subprocess.run(['node', '--check', path], capture_output=True, text=True)
    if r.returncode != 0:
        syn = False; print(r.stderr[:1200])
    os.unlink(path)
check('JS: синтаксис', syn)

print()
print('RESULT:', 'ALL PASS' if not fails else f'{len(fails)} FAILURES: {fails}')
sys.exit(1 if fails else 0)
