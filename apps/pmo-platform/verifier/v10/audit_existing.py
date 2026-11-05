#!/usr/bin/env python3
# verifier/v10 — аудит: 7 пунктов запроса «механика предложений ИИ и доверие» уже реализованы.
# Код не менялся (по инструкции пользователя «реализовано иначе → сообщить, не делать»).
import re, subprocess, tempfile, os, sys

APP = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
html = open(os.path.join(APP, 'index.html'), encoding='utf-8').read()
fails = []

def check(name, cond, detail=''):
    print(('PASS' if cond else 'FAIL'), '-', name, ('| ' + detail if detail else ''))
    if not cond:
        fails.append(name)

# П.1 Кликабельный источник: бейдж-ссылка + попап с полным текстом и «Перейти →»
check('п.1 srcBadgeHTML — кликабельный бейдж источника', 'function srcBadgeHTML' in html and 'srcPop(' in html)
check('п.1 srcPop — попап с полным источником и кнопкой перехода', 'источник записи' in html and 'Перейти →' in html)
check('п.1 авто-записи рисков используют srcBadgeHTML', "x.type==='auto' ? srcBadgeHTML" in html)

# П.2 Бейдж канала TG/почта/MAX/чат
check('п.2 CH_BADGE: tg/mail/max/chat', all(k in html for k in ["tg:'TG'", "mail:'почта'", "max:'MAX'", "chat:'чат"]))
check('п.2 CSS-бейджи каналов', all(c in html for c in ['.ch-badge.ch-tg', '.ch-badge.ch-mail', '.ch-badge.ch-max', '.ch-badge.ch-chat']))

# П.3 Diff-паттерн «изменить» (кейс P-08 → P-04, срок 18.09 → 22.09)
check('п.3 предложение kind:change существует', "kind:'change'" in html)
check('п.3 кейс P-08: срок P-04 18.09→22.09', "diff:{target:'P-04', field:'срок', from:'18.09', to:'22.09'}" in html)
check('п.3 рендер diff (зачёркнуто → новое)', 'pend-diff' in html and 'diff-from' in html and 'diff-to' in html)
check('п.3 applyProposal применяет change', "p.kind==='change'&&p.diff" in html)

# П.4 Дедупликация (P-09 ≈ P-06, 92%)
check('п.4 dup-поле в данных', "dup:{of:'P-06', pct:92}" in html)
check('п.4 тег «возможный дубль»', 'возможный дубль' in html)
check('п.4 плашка «похоже на … — объединить?»', 'похоже на' in html and 'объединить?' in html)
check('п.4 propMerge реализован', 'function propMerge' in html)

# П.5 Блок «Почему предлагает» во всех реестрах (общий propRowHTML)
check('п.5 prop-why/prop-eff в детали предложения', 'Почему предлагает:' in html and 'Эффект:' in html)
check('п.5 поля why/effect у предложений поручений и рисков',
      html.count("why:'") >= 8 and html.count("effect:'") >= 6)

# П.6 Права: утверждает только РП
check('п.6 USER_ROLE + pendActsHTML блокирует не-РП', "USER_ROLE!=='rp'" in html and 'Утверждать предложения может только РП' in html)
check('п.6 участнику — «💬 комментарий» вместо утверждения', 'Комментарий для РП' in html)
check('п.6 setRole реализован', 'function setRole' in html)
print('  note: демо-переключатель roleSwitchHTML() определён, но не смонтирован в разметке:',
      'roleSwitchHTML()' in html)

# П.7 Решения не тронуты — журнал решений на месте
check('п.7 экран Решений существует (renderDecisionsView)', 'renderDecisionsView' in html)

# Предложения показаны во всех реестрах
check('pendRowsHTML в tasks/risks/stake', all(f"pendRowsHTML('{r}'" in html for r in ['tasks', 'risks', 'stake']))

print()
print('RESULT:', 'ALL PASS' if not fails else f'{len(fails)} FAILURES: {fails}')
sys.exit(1 if fails else 0)
