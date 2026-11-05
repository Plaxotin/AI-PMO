#!/usr/bin/env python3
# verifier/v13 — переработана только иллюстрация полного цикла (матрёшки L0–L4) в landing.html.
# Остальные секции, тексты и функциональность не тронуты.
import re, os, sys

APP = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
b = open(os.path.join(APP, 'landing.html'), encoding='utf-8').read()
fails = []

def check(name, cond, detail=''):
    print(('PASS' if cond else 'FAIL'), '-', name, ('| ' + detail if detail else ''))
    if not cond:
        fails.append(name)

# Единая система: один общий силуэт, 5 экземпляров
check('общий силуэт матрёшки (symbol#dollshape)', 'id="dollshape"' in b)
check('ровно 5 матрёшек', b.count('<use href="#dollshape"') == 5)

# Подписи уровней сохранены
for t in ['L0', 'L1', 'L2', 'L3', 'L4']:
    check(f'подпись {t}', f'<b>{t}</b>' in b)
for t in ['Надзор за каналами', 'Информирование', 'Фиксация риска', 'Решение', 'Исполнение']:
    check(f'название «{t}»', t in b)

# Разные метафоры по уровням
check('L0: поток сообщений + выделенное (Иванов/приёмка)', 'Иванов: перегружен перед приёмкой релиза' in b and 'msg hot' in b)
check('L1: фильтрация → сигнал со ссылкой на источник', 'Перегрузка Иванова угрожает приёмке релиза' in b and 'источник: TG · 14:32' in b)
check('L2: карточка риска (причина/вероятность/влияние/владелец)', all(x in b for x in ['риск · R-107', 'причина', 'вероятность', 'влияние', 'владелец']))
check('L3: решение + подтверждение руководителем', 'Перераспределить 4 задачи' in b and 'Подтвердить' in b and 'решение — за руководителем' in b)
check('L4: поручения с исполнителями/сроками/статусами', 'интеграционные тесты' in b and 'протокол приёмки' in b and 'контроль исполнения' in b)

# Янтарная нить передачи контекста между уровнями
check('4 перехода-коннектора', b.count('class="hand"') == 4)
for t in ['сообщение', 'сигнал', 'риск', 'решение']:
    check(f'коннектор «{t}»', f'<span class="hand-tx">{t}</span>' in b)
check('янтарный маркер в стилях (var(--gold)/#FCCF00)', 'hand-ic' in b and '--gold' in b)

# Ничего лишнего не добавлено / не сломано
check('старый PNG больше не используется в разметке', 'matreshka-full-cycle.png' not in b)
check('подпись под иллюстрацией без изменений', 'Каждый следующий артефакт включает контекст предыдущего' in b)
check('hero не тронут', 'Узнавайте о рисках проекта' in b)
check('3 пункта проблема→результат на месте', b.count('class="prow"') == 3)
check('4 направления возможностей на месте', b.count('class="capr"') == 4)
check('демо #live с кнопками не тронуто', 'data-act="accept"' in b and 'id="bub4"' in b)
chain = b[b.index('<div class="chain">'):b.index('</figure>')]
check('в иллюстрации решение подтверждает руководитель, автоматики нет', 'Подтвердить' in chain and 'автоматически' not in chain.lower())
check('мобильная прокрутка схемы', '.chain{min-width:1000px}' in b)

print()
print('RESULT:', 'ALL PASS' if not fails else f'{len(fails)} FAILURES: {fails}')
sys.exit(1 if fails else 0)
