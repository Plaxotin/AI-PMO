#!/usr/bin/env python3
"""v3: mobile matryoshka layout — vertical strip L0 top, card right of each doll."""
import os, re, sys

APP = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
html = open(os.path.join(APP, 'landing.html'), encoding='utf-8').read()
fails = []

# 1. doll slice files exist
for i in range(5):
    if not os.path.isfile(os.path.join(APP, f'doll-l{i}.png')):
        fails.append(f'missing doll-l{i}.png')

# 2. mpairs block: 5 rows, correct order, img matches card level
m = re.search(r'<div class="mpairs">(.*?)</div>\s*<div style="margin-top:20px', html, re.S)
if not m:
    fails.append('mpairs block not found')
else:
    block = m.group(1)
    rows = re.findall(r'<div class="mpair">(.*?)</div></div>', block, re.S)
    if len(rows) != 5:
        fails.append(f'mpair rows: {len(rows)} != 5')
    for i, row in enumerate(rows[:5]):
        if f'doll-l{i}.png' not in row:
            fails.append(f'row {i}: wrong/missing doll image')
        if f'L{i} ·' not in row:
            fails.append(f'row {i}: card level tag missing')

# 3. each doll image referenced exactly once overall
for i in range(5):
    n = html.count(f'doll-l{i}.png')
    if n != 1:
        fails.append(f'doll-l{i}.png referenced {n} times')

# 4. mobile CSS rules
need = ['.mpairs{display:none}', '@media (max-width:640px)',
        '.mpair{display:flex', '.mpair>img', '.mpair>.lcard',
        '.lcards{display:none}', '.scheme{display:none}',
        '.swipe-hint{display:none']
for s in need:
    if s not in html:
        fails.append(f'css missing: {s}')

# 5. desktop still has horizontal scheme + lcards intact
if 'matreshka-full-cycle.png' not in html:
    fails.append('desktop scheme image lost')
if html.count('class="lcard"') < 10:
    fails.append('lcard count < 10 (desktop 5 + mobile 5 expected)')

print('FAILS:', fails if fails else 'NONE')
sys.exit(1 if fails else 0)
