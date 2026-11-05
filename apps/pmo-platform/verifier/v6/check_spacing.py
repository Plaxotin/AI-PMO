#!/usr/bin/env python3
"""v6: uniform spacing between nested outline sizes (equal height steps)."""
import os, sys
import numpy as np
from PIL import Image

APP = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
fails = []

heights = []
widths = []
for i in range(5):
    p = os.path.join(APP, f'mrow-l{i}.png')
    if not os.path.isfile(p):
        fails.append(f'missing mrow-l{i}.png'); continue
    a = np.array(Image.open(p).convert('RGBA'))
    m = a[:, :, 3] > 200
    ys, xs = np.where(m)
    heights.append(int(ys.max() - ys.min()))
    widths.append(int(xs.max() - xs.min()))

if len(heights) == 5:
    dh = [heights[i] - heights[i + 1] for i in range(4)]
    dw = [widths[i] - widths[i + 1] for i in range(4)]
    radial = [dh[i] + dw[i] for i in range(4)]  # 2x avg radial gap
    if max(radial) - min(radial) > 10:
        fails.append(f'radial gaps not uniform: {radial} (dh={dh} dw={dw})')
    if min(dh) < 30 or min(dw) < 20:
        fails.append(f'some gap too small: dh={dh} dw={dw}')
    print('heights:', heights, 'steps:', dh)
    print('widths:', widths, 'steps:', dw)

print('FAILS:', fails if fails else 'NONE')
sys.exit(1 if fails else 0)
