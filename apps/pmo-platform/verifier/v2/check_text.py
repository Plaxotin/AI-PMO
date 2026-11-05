import re, sys
h = open('/mnt/agents/output/app/landing.html', encoding='utf-8').read()
fails = []
for bad in ['два клика','2 клика','двух кликов','Два клика']:
    if bad in h: fails.append(f'найдено запрещённое: {bad}')
n3 = h.count('три клика') + h.count('трёх кликов')
if n3 < 3: fails.append(f'«три клика» встречается {n3} раз (<3)')
for m in re.finditer(r'три клика', h):
    seg = h[max(0,m.start()-260):m.start()]
    if '<a' not in seg and 'href="#live"' not in seg:
        fails.append('«три клика» без ссылки #live около позиции %d' % m.start())
# демо: три кнопки-шага
for act in ['data-act="open"','data-act="confirm"','data-act="accept"','data-act="discuss"','data-act="decline"']:
    if act not in h: fails.append(f'нет кнопки {act}')
for cid in ['card2','card3','card4']:
    if f'id="{cid}"' not in h: fails.append(f'нет карточки {cid}')
print('FAILS:', fails if fails else 'NONE'); sys.exit(1 if fails else 0)
