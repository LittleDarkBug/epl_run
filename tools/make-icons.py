# Genere les icones de l'application (PWA, Apple, favicon).
# Usage : python3 tools/make-icons.py chemin/vers/ArchivoBlack.ttf
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FONT = sys.argv[1]
COLS = [(228, 31, 38), (245, 209, 13), (20, 194, 176), (61, 139, 255), (195, 25, 155)]


def make(size, k):
    S = size * 4
    im = Image.new('RGBA', (S, S))
    d = ImageDraw.Draw(im)
    for y in range(S):
        t = y / S
        d.line([(0, y), (S, y)], fill=(int(11 + 9 * t), int(26 + 44 * t), int(74 + 86 * t), 255))
    glow = Image.new('RGBA', (S, S))
    ImageDraw.Draw(glow).ellipse([S * 0.15, S * 0.1, S * 0.85, S * 0.8], fill=(90, 140, 255, 90))
    im = Image.alpha_composite(im, glow.filter(ImageFilter.GaussianBlur(S * 0.08)))
    cx = S / 2
    card = Image.new('RGBA', (S, S))
    cd = ImageDraw.Draw(card)
    fs = int(S * 0.2 * k)
    f = ImageFont.truetype(FONT, fs)
    w1 = cd.textlength('EPL', font=f)
    w2 = cd.textlength('RUN', font=f)
    pad = fs * 0.18
    h = fs * 1.18
    total = w1 + w2 + pad * 4
    x0 = cx - total / 2
    y0 = S * 0.45 - h / 2
    split = x0 + w1 + pad * 2
    cd.rounded_rectangle([x0, y0, x0 + total, y0 + h], radius=fs * 0.14, fill=(251, 250, 246, 255))
    cd.rounded_rectangle([x0, y0, split, y0 + h], radius=fs * 0.14, fill=(20, 70, 160, 255))
    cd.rectangle([split - fs * 0.2, y0, split, y0 + h], fill=(20, 70, 160, 255))
    cd.text((x0 + pad, y0 + h * 0.5), 'EPL', font=f, fill=(255, 255, 255, 255), anchor='lm')
    cd.text((split + pad, y0 + h * 0.5), 'RUN', font=f, fill=(10, 15, 31, 255), anchor='lm')
    bw, gap, n = fs * 0.1, fs * 0.07, 10
    bx = cx - (n * bw + (n - 1) * gap) / 2
    by = y0 + h + fs * 0.25
    for i in range(n):
        x = bx + i * (bw + gap)
        cd.polygon([(x + fs * 0.12, by), (x + bw + fs * 0.12, by), (x + bw, by + fs * 0.42), (x, by + fs * 0.42)], fill=COLS[i % 5] + (255,))
    card = card.rotate(8, resample=Image.BICUBIC, center=(cx, S * 0.5))
    shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    shadow.paste((0, 0, 0, 120), mask=card.split()[3].filter(ImageFilter.GaussianBlur(S * 0.012)))
    shadow = shadow.transform((S, S), Image.AFFINE, (1, 0, 0, 0, 1, -S * 0.014))
    im = Image.alpha_composite(Image.alpha_composite(im, shadow), card)
    return im.resize((size, size), Image.LANCZOS)


make(512, 0.82).save('public/icons/icon-512.png')
make(192, 0.82).save('public/icons/icon-192.png')
make(512, 0.62).save('public/icons/icon-maskable-512.png')
make(192, 0.62).save('public/icons/icon-maskable-192.png')
make(180, 0.8).convert('RGB').save('public/icons/apple-touch-icon.png')
make(64, 0.9).save('public/icons/favicon-64.png')
print('icones ecrites')
