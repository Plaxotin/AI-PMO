#!/usr/bin/env python3
"""v5: mobile rows — uniform L0 color dolls, clean outer-only outlines, L1 +7..10% (< L0), no captions."""
import os, sys
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
    a = np.array(Image.open(p).convert('RGBA'))
    if a[0, 0, 3] != 0 or a[-1, -1, 3] != 0:
        fails.append(f'mrow-l{i} background not transparent')
    imgs.append(a)

if len(imgs) == 5:
    if len({a.shape[:2] for a in imgs}) != 1:
        fails.append('row canvases differ')
    # outlines: mid-alpha pixels
    counts = [int(((a[:, :, 3] > 30) & (a[:, :, 3] < 140)).sum()) for a in imgs]
    if counts[0] != 0:
        fails.append(f'L0 has outline pixels: {counts[0]}')
    if not all(counts[i] < counts[i + 1] for i in range(4)):
        fails.append(f'outline counts not increasing: {counts}')
    # doll heights (opaque) strictly decreasing; L1 within 80-95% of L0
    heights = []
    for a in imgs:
        ys = np.where((a[:, :, 3] > 200).any(axis=1))[0]
        heights.append(int(ys.max() - ys.min()))
    if not all(heights[i] > heights[i + 1] for i in range(4)):
        fails.append(f'doll heights not decreasing: {heights}')
    ratio = heights[1] / heights[0]
    if not (0.80 <= ratio <= 0.95):
        fails.append(f'L1/L0 height ratio {ratio:.2f} outside 0.80-0.95')
    # uniform doll color: median blue-family color of each doll ~ L0's
    def med_blue(a):
        r, g, b = a[:, :, 0].astype(int), a[:, :, 1].astype(int), a[:, :, 2].astype(int)
        m = (b - r > 25) & (b > 90) & (a[:, :, 3] > 200)
        # restrict to central doll area (skip outlines: they are mid-alpha, already excluded)
        return np.array([np.median(a[:, :, c][m]) for c in range(3)])
    base = med_blue(imgs[0])
    for i in range(1, 5):
        d = np.abs(med_blue(imgs[i]) - base).sum()
        if d > 120:
            fails.append(f'mrow-l{i} doll color differs from L0: {med_blue(imgs[i])} vs {base}')
    print('outline px:', counts, 'heights:', heights, 'L1/L0:', round(ratio, 3), 'base color:', base)

# captions removed
if 'mcap' in html:
    fails.append('mcap captions still present')
for i in range(5):
    if html.count(f'mrow-l{i}.png') != 1:
        fails.append(f'mrow-l{i}.png ref count {html.count(f"mrow-l{i}.png")}')
if '.mpair>.mdoll' not in html:
    fails.append('mdoll css missing')

print('FAILS:', fails if fails else 'NONE')
sys.exit(1 if fails else 0)
