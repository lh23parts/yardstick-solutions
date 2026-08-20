#!/usr/bin/env python3
"""Render text as the poster's letterpress ink.

The artwork has no letter "E" anywhere, so any new copy has to be set rather
than lifted from a photo. Impact at 88% width matches the poster's proportions
(the poster runs ~33px per character at 62px cap height; Impact runs ~39px), and
the ink breakup is tuned to the measured statistics of contact-email.png's ink:
mean alpha 0.95 inside strokes, ~12% of pixels below 0.85.

Run from the repo root:  python3 tools/make-ink-assets.py
"""

from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np
import os

FONT_PATH = '/System/Library/Fonts/Supplemental/Impact.ttf'
INK = (30, 9, 7)          # the poster's own letterpress black
SQUEEZE = 0.88            # horizontal scale to match the poster's proportions
TRACK = 1.0               # extra px between glyphs, to loosen Impact's tight fit
BREAK_T = 0.63            # noise threshold where ink starts to break up
BREAK_DEPTH = 0.80        # how far broken pixels drop in alpha


def render_ink(lines, size=78, leading=1.18, seed=7):
    """Return an RGBA image of `lines` set in the poster's ink."""
    font = ImageFont.truetype(FONT_PATH, size)
    rng = np.random.default_rng(seed)

    # lay out each line glyph by glyph so we can add tracking
    widths, rendered = [], []
    for line in lines:
        w = sum(font.getlength(ch) + TRACK for ch in line)
        widths.append(w)
    canvas_w = int(max(widths)) + 8
    line_h = int(size * leading)
    canvas_h = line_h * len(lines) + size

    mask = Image.new('L', (canvas_w, canvas_h), 0)
    d = ImageDraw.Draw(mask)
    for i, line in enumerate(lines):
        x = 4.0
        y = 8 + i * line_h
        for ch in line:
            d.text((x, y), ch, font=font, fill=255)
            x += font.getlength(ch) + TRACK

    mask = mask.crop(mask.getbbox())
    w, h = mask.size
    mask = mask.resize((int(round(w * SQUEEZE)), h), Image.LANCZOS)
    w, h = mask.size
    a = np.asarray(mask).astype(np.float32) / 255.0

    # ink breakup: small clusters of lightened pixels, matched to the real ink
    n = rng.random((h, w)).astype(np.float32)
    n = np.asarray(
        Image.fromarray((n * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))
    ).astype(np.float32) / 255.0
    n = (n - n.min()) / (n.max() - n.min())
    m = np.ones_like(n)
    hi = n > BREAK_T
    m[hi] = 1.0 - BREAK_DEPTH * ((n[hi] - BREAK_T) / (1 - BREAK_T))
    a = a * m

    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[:, :, 0], out[:, :, 1], out[:, :, 2] = INK
    out[:, :, 3] = np.clip(a * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(out)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    jobs = [
        ('order-button.png', ['ORDER@YARDSTICKSOLUTIONS.COM'], 7),
        ('out-of-ammo.png', ['YOU HAVE RAN OUT OF AMMO.',
                             'EVER FEEL LIKE YOUR BUSINESS',
                             'IS OUT OF AMMO?'], 11),
    ]
    # ammo counter states, 6/6 down to 0/6
    for i in range(7):
        jobs.append((f'ammo-{i}.png', [f'{i}/6'], 20 + i))

    for name, lines, seed in jobs:
        img = render_ink(lines, seed=seed)
        path = os.path.join(root, name)
        img.save(path)
        print(f'{name}: {img.size[0]}x{img.size[1]}')


if __name__ == '__main__':
    main()
