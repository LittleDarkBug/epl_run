"""Texture de feuillage (RGBA) pour les arbres d'ombrage : grappes de
feuilles de neem / cailcedrat vues de pres, avec transparence.
Usage : python tools/blender/foliage.py assets-src/trees/tex
"""
import math
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 1024
rng = np.random.default_rng(11)


def leaf(draw, cx, cy, length, width, ang, col):
    # Feuille lanceolee : polygone le long d'un axe.
    pts_l, pts_r = [], []
    for i in range(12):
        t = i / 11
        w = width * math.sin(math.pi * t) ** 0.8
        x = cx + math.cos(ang) * length * t
        y = cy + math.sin(ang) * length * t
        pts_l.append((x - math.sin(ang) * w, y + math.cos(ang) * w))
        pts_r.append((x + math.sin(ang) * w, y - math.cos(ang) * w))
    draw.polygon(pts_l + pts_r[::-1], fill=col)
    # Nervure centrale.
    draw.line([(cx, cy), (cx + math.cos(ang) * length * 0.9, cy + math.sin(ang) * length * 0.9)],
              fill=tuple(int(c * 0.8) for c in col[:3]) + (255,), width=1)


def cluster(size, n_twigs, seed):
    r = np.random.default_rng(seed)
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    greens = [(52, 92, 36), (66, 110, 42), (82, 128, 50), (46, 80, 32), (95, 140, 58), (110, 150, 60)]
    c = size / 2
    for _ in range(n_twigs):
        # Rameau : tige et feuilles opposees (feuille composee de neem).
        ang = r.uniform(0, 2 * math.pi)
        dist = r.uniform(0, size * 0.34)
        sx, sy = c + math.cos(ang) * dist * 0.4, c + math.sin(ang) * dist * 0.4
        tang = ang + r.uniform(-0.6, 0.6)
        tl = r.uniform(size * 0.22, size * 0.36)
        ex, ey = sx + math.cos(tang) * tl, sy + math.sin(tang) * tl
        d.line([(sx, sy), (ex, ey)], fill=(70, 60, 35, 255), width=max(1, size // 300))
        pairs = 7
        for k in range(pairs):
            t = 0.2 + 0.8 * k / pairs
            px, py = sx + (ex - sx) * t, sy + (ey - sy) * t
            L = size * r.uniform(0.045, 0.065)
            W = L * 0.28
            base = greens[r.integers(len(greens))]
            shade = r.uniform(0.8, 1.15)
            col = tuple(int(min(255, v * shade)) for v in base) + (255,)
            for s in (-1, 1):
                leaf(d, px, py, L, W, tang + s * r.uniform(0.7, 1.1), col)
        leaf(d, ex, ey, size * 0.06, size * 0.017, tang, greens[1] + (255,))
    return img


if __name__ == '__main__':
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    # Atlas 2 x 2 de grappes differentes.
    atlas = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    for i in range(4):
        cl = cluster(S // 2, 16, 100 + i)
        atlas.alpha_composite(cl, ((i % 2) * S // 2, (i // 2) * S // 2))
    # Assombrissement vers le centre des grappes (volume).
    a = np.array(atlas).astype(float)
    yy, xx = np.mgrid[0:S, 0:S]
    cx = (xx % (S // 2)) - S / 4
    cy = (yy % (S // 2)) - S / 4
    dist = np.sqrt(cx * cx + cy * cy) / (S / 4)
    a[..., :3] *= (0.72 + 0.28 * np.clip(dist, 0, 1))[..., None]
    # Couleur debordant sous la transparence (evite les liseres sombres au mipmapping).
    rgb = Image.fromarray(a[..., :3].astype(np.uint8))
    alpha = a[..., 3]
    blurred = np.array(rgb.filter(ImageFilter.GaussianBlur(6))).astype(float)
    mask = (alpha > 10)[..., None]
    fill = np.where(mask, a[..., :3], blurred * 1.0)
    fill = np.where(mask, fill, np.array([60, 95, 40]))
    out_img = Image.fromarray(np.concatenate([fill, alpha[..., None]], -1).astype(np.uint8), 'RGBA')
    out_img.save(os.path.join(out, 'leaves.png'))
    # Ecorce tuilable.
    from scipy.ndimage import gaussian_filter
    n = gaussian_filter(rng.standard_normal((512, 512)), (40, 1.5), mode='wrap')
    n = (n - n.min()) / (n.max() - n.min())
    f = gaussian_filter(rng.standard_normal((512, 512)), 2, mode='wrap')
    f = (f - f.min()) / (f.max() - f.min())
    v = 0.55 + 0.35 * n + 0.15 * (f - 0.5)
    bark = np.stack([v * 0.42, v * 0.33, v * 0.25], -1)
    Image.fromarray((np.clip(bark, 0, 1) * 255).astype(np.uint8)).save(os.path.join(out, 'bark.jpg'), quality=90)
    print('feuillage ok')
