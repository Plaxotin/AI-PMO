#!/usr/bin/env python3
"""v7: down-chevrons between mobile matryoshka cards (4 gaps, card-column aligned, desktop-hidden)."""
import os, re, sys

APP = os.path.dirname(os.path.dirname(os.path.abspath(os.path.dirname(os.path.abspath(__file__)))))
APP = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
html = open(os.path.join(APP, 'landing.html'), encoding='utf-8').read()
fails = []

n = len(re.findall(r'<div class="mchev"><i></i></div>', html))
if n != 4:
    fails.append(f'mchev divs: {n} != 4')
for s in ['.mchev{display:none}', '.mchev i{', 'rotate(45deg)']:
    if s not in html:
        fails.append(f'css missing: {s}')
# chevrons sit between mpairs inside mpairs block
m = re.search(r'<div class="mpairs">(.*?)</div>\s*<div style="margin-top:20px', html, re.S)
if m:
    body = m.group(1)
    seq = re.findall(r'class="(mpair|mchev)"', body)
    expected = ['mpair', 'mchev', 'mpair', 'mchev', 'mpair', 'mchev', 'mpair', 'mchev', 'mpair']
    if seq != expected:
        fails.append(f'mpair/mchev sequence wrong: {seq}')
else:
    fails.append('mpairs block not found')

print('FAILS:', fails if fails else 'NONE')
sys.exit(1 if fails else 0)
