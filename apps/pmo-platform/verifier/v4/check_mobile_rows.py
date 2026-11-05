#!/usr/bin/env python3
"""v4: mobile matryoshka rows — true-size dolls + nested outlines of previous dolls, transparent bg."""
import os, re, sys
import numpy as np
from PIL import Image

APP = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
html = open(os.path.join(APP, 'landing.html'), encoding='utf-8').read()
fails = []

imgs = []
for i in range(5):
    p = os.path.join(APP, f'mrow-l{i}.png')
    if not os.path.isfile(p):
        fails.append(f'missing mrow-l{i}.png'); continue
    im = Image.open(p)
    if im.mode != 'RGBA':
        fails.append(f'mrow-l{i} not RGBA'); continue
    a = np.array(im)
    # transparent background (corners fully transparent)
    if a[0,0,3] != 0 or a[-1,-1,3] != 0:
        fails.append(f'mrow-l{i} background not transparent')
    imgs.append(a)

if len(imgs) == 5:
    # uniform canvas
    sizes = {a.shape[:2] for a in imgs}
    if len(sizes) != 1:
        fails.append(f'row canvases differ: {sizes}')
    # outline count: pixels with alpha in mid band (outline ring, neither doll nor bg)
    counts = []
    for a in imgs:
        alpha = a[:,:,3]
        counts.append(int(((alpha > 30) & (alpha < 140)).sum()))
    if counts[0] != 0:
        fails.append(f'L0 has outline pixels: {counts[0]}')
    if not all(counts[i] < counts[i+1] for i in range(4)):
        fails.append(f'outline counts not increasing: {counts}')
    # true proportions: opaque doll heights strictly decreasing
    heights = []
    for a in imgs:
        ys = np.where((a[:,:,3] > 200).any(axis=1))[0]
        heights.append(int(ys.max()-ys.min()))
    if not all(heights[i] > heights[i+1] for i in range(4)):
        fails.append(f'doll heights not decreasing: {heights}')
    print('outline px:', counts, 'doll heights px:', heights)

# HTML wiring
for i in range(5):
    if html.count(f'mrow-l{i}.png') != 1:
        fails.append(f'mrow-l{i}.png referenced {html.count(f"mrow-l{i}.png")} times')
if 'doll-l' in html:
    fails.append('stale doll-l references remain')
caps = ['L0 — надзор','L1 — информирование','L2 — фиксация','L3 — решение','L4 — исполнение']
for c in caps:
    if f'<span class="mcap">{c}</span>' not in html:
        fails.append(f'missing caption: {c}')
for s in ['.mpair>.mdoll', '.mdoll img', '.mcap{']:
    if s not in html:
        fails.append(f'css missing: {s}')

print('FAILS:', fails if fails else 'NONE')
sys.exit(1 if fails else 0)
