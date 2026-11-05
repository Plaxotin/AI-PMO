#!/usr/bin/env python3
"""v8: workspace bot avatar = matryoshka face from hero image (expression unchanged)."""
import os, sys

APP = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
html = open(os.path.join(APP, 'index.html'), encoding='utf-8').read()
fails = []

p = os.path.join(APP, 'avatar-matreshka.png')
if not os.path.isfile(p):
    fails.append('avatar-matreshka.png missing')
else:
    from PIL import Image
    im = Image.open(p)
    if im.size != (256, 256):
        fails.append(f'avatar size {im.size} != 256x256')

n = html.count('<div class="avatar"><img src="avatar-matreshka.png" alt="ИИ-ассистент"></div>')
if n != 2:
    fails.append(f'avatar markup count {n} != 2 (bot template + welcome)')
if '<div class="avatar">AI</div>' in html:
    fails.append('stale text AI avatar remains')
if '.avatar img{' not in html:
    fails.append('avatar img CSS missing')
# user avatar untouched
if '<div class="avatar">КП</div>' not in html:
    fails.append('user avatar КП lost')

print('FAILS:', fails if fails else 'NONE')
sys.exit(1 if fails else 0)
