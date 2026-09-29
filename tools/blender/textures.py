"""Textures tuilables (sans raccord) pour le decor modelise dans Blender.

Chaque texture est periodique par construction : bruits filtres en mode
"wrap", motifs calcules sur le tore. Sorties : couleur (JPEG sRGB) et
relief (normal map JPEG), en 1024 px.
Usage : python tools/blender/textures.py assets-src/campus/tex
"""
import os
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

N = 1024
rng = np.random.default_rng(7)


def noise(sigma, n=N, seed=None):
    r = np.random.default_rng(seed) if seed is not None else rng
    a = gaussian_filter(r.standard_normal((n, n)), sigma, mode='wrap')
    a -= a.min()
    return a / (a.max() + 1e-9)


def fbm(base, octaves=5, n=N):
    out = np.zeros((n, n))
    amp, tot, s = 1.0, 0.0, base
    for _ in range(octaves):
        out += noise(s, n) * amp
        tot += amp
        amp *= 0.55
        s = max(0.6, s / 2.1)
    return out / tot


def vstreaks(n=N, density=0.02, length=60):
    """Coulures verticales (pluie) periodiques."""
    a = np.zeros((n, n))
    cols = rng.random(n) < density
    a[:, cols] = rng.random((n, cols.sum()))
    a = gaussian_filter(a, (length, 1.2), mode='wrap')
    return a / (a.max() + 1e-9)


def spots(count, rmin, rmax, n=N):
    a = np.zeros((n, n))
    yy, xx = np.mgrid[0:n, 0:n]
    for _ in range(count):
        cx, cy = rng.random() * n, rng.random() * n
        r = rmin + rng.random() * (rmax - rmin)
        dx = np.minimum(abs(xx - cx), n - abs(xx - cx))
        dy = np.minimum(abs(yy - cy), n - abs(yy - cy))
        a = np.maximum(a, np.clip(1 - np.sqrt(dx * dx + dy * dy) / r, 0, 1))
    return a


def normal_from_height(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    nz = np.ones_like(h)
    l = np.sqrt(gx * gx + gy * gy + nz * nz)
    n = np.stack([-gx / l, gy / l, nz / l], -1)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)


def hex_rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)]) / 255.0


def to_img(rgb):
    return Image.fromarray((np.clip(rgb, 0, 1) ** (1 / 1.0) * 255).astype(np.uint8))


def save(out, name, rgb, height=None, strength=4.0):
    to_img(rgb).save(os.path.join(out, f'{name}.jpg'), quality=90)
    if height is not None:
        Image.fromarray(normal_from_height(height, strength)).resize((512, 512), Image.LANCZOS).save(os.path.join(out, f'{name}_n.jpg'), quality=90)
    print('texture', name)


def tint(base_hex, var):
    base = hex_rgb(base_hex)
    return base[None, None, :] * var[..., None]


def plaster(out, name, color, stains=0.25):
    low = fbm(90, 3)
    grain = noise(0.8)
    pores = (noise(1.5) > 0.82).astype(float) * 0.5
    streak = vstreaks()
    var = 0.9 + 0.14 * (low - 0.5) + 0.05 * (grain - 0.5) - 0.07 * pores - stains * 0.35 * streak
    rgb = tint(color, var)
    # Salissures grises dans les zones basses du bruit.
    dirt = np.clip((fbm(60, 3) - 0.62) * 3, 0, 1)
    rgb = rgb * (1 - dirt[..., None] * 0.18 * stains * 3) + np.array([0.35, 0.3, 0.25]) * dirt[..., None] * 0.06
    h = grain * 0.6 + fbm(6, 3) * 0.4 - pores * 0.4
    save(out, name, rgb, h, 2.2)


def concrete(out):
    low = fbm(70, 3)
    grain = noise(0.7)
    pores = (noise(1.2) > 0.85).astype(float)
    var = 0.88 + 0.12 * (low - 0.5) + 0.06 * (grain - 0.5) - 0.12 * pores - 0.12 * vstreaks(density=0.015)
    save(out, 'concrete', tint('#d8d4cb', var), grain * 0.5 - pores * 0.5, 2.5)


def panels(out):
    # Peinture gris-bleu sur beton : legeres traces de rouleau.
    low = fbm(80, 3)
    roll = gaussian_filter(rng.standard_normal((N, N)), (0.6, 30), mode='wrap')
    roll = (roll - roll.min()) / (roll.max() - roll.min())
    grain = noise(0.8)
    var = 0.92 + 0.1 * (low - 0.5) + 0.05 * (roll - 0.5) + 0.04 * (grain - 0.5) - 0.12 * vstreaks(density=0.012, length=90)
    save(out, 'panel', tint('#aeb9c8', var), grain * 0.4 + roll * 0.3, 1.6)


def metal(out):
    low = fbm(40, 4)
    rust = np.clip((fbm(25, 4) - 0.6) * 4, 0, 1)
    scratches = gaussian_filter((rng.random((N, N)) > 0.9994).astype(float), (0.5, 12), mode='wrap')
    scratches = np.clip(scratches * 40, 0, 1)
    rgb = tint('#3a3f46', 0.9 + 0.2 * (low - 0.5))
    rgb = rgb * (1 - rust[..., None]) + np.array([0.42, 0.2, 0.1]) * rust[..., None] * (0.8 + 0.4 * low[..., None])
    rgb = rgb + scratches[..., None] * 0.15
    save(out, 'metal', rgb, rust * 0.6 + low * 0.2, 3.0)


def roof(out):
    x = np.arange(N) / N
    corr = 0.5 + 0.5 * np.sin(x * 2 * np.pi * 14)  # 14 ondes par tuile
    corr = np.tile(corr[None, :], (N, 1))
    rust = np.clip((fbm(30, 4) - 0.58) * 3.5, 0, 1) * (0.6 + 0.4 * vstreaks(density=0.03, length=120))
    rgb = tint('#9aa1a8', 0.85 + 0.15 * corr + 0.1 * (fbm(50, 3) - 0.5))
    rgb = rgb * (1 - rust[..., None] * 0.8) + np.array([0.45, 0.25, 0.12]) * rust[..., None] * 0.8
    save(out, 'roof', rgb, corr + rust * 0.1, 6.0)


def green_roof(out):
    seams = np.zeros(N)
    seams[(np.arange(N) % 128) < 6] = 1
    seams = np.tile(seams[None, :], (N, 1))
    low = fbm(60, 3)
    rgb = tint('#4f8a5b', 0.9 + 0.15 * (low - 0.5) - 0.2 * seams - 0.12 * vstreaks(density=0.02, length=100))
    save(out, 'roof_green', rgb, seams * 0.8 + noise(1) * 0.2, 4.0)


def laterite(out):
    low = fbm(80, 3)
    mid = fbm(12, 4)
    grain = noise(0.7)
    pebbles = spots(260, 2, 7)
    rgb = tint('#a8583a', 0.82 + 0.25 * (low - 0.5) + 0.18 * (mid - 0.5) + 0.08 * (grain - 0.5))
    # Zones plus claires et poussiereuses, cailloux clairs.
    dust = np.clip((low - 0.55) * 3, 0, 1)
    rgb = rgb * (1 - dust[..., None] * 0.25) + np.array([0.72, 0.52, 0.4]) * dust[..., None] * 0.25
    rgb = rgb * (1 - pebbles[..., None] * 0.5) + np.array([0.7, 0.62, 0.55]) * pebbles[..., None] * 0.5
    h = mid * 0.5 + grain * 0.2 + pebbles * 0.6
    save(out, 'laterite', rgb, h, 5.0)


def grass(out):
    blades = gaussian_filter(rng.random((N, N)), (4, 0.6), mode='wrap')
    blades = (blades - blades.min()) / (blades.max() - blades.min())
    low = fbm(70, 3)
    dry = np.clip((fbm(50, 3) - 0.45) * 2.5, 0, 1)
    green = hex_rgb('#6d8a35')
    straw = hex_rgb('#b7a55a')
    base = green * (1 - dry[..., None]) + straw * dry[..., None]
    rgb = base * (0.7 + 0.5 * blades[..., None]) * (0.9 + 0.2 * low[..., None])
    soil = np.clip((0.35 - blades) * 3, 0, 1) * np.clip((fbm(30, 3) - 0.5) * 3, 0, 1)
    rgb = rgb * (1 - soil[..., None]) + hex_rgb('#8a4a30') * soil[..., None]
    save(out, 'grass', rgb, blades, 4.0)


def hedge(out):
    leaves = np.maximum(spots(2600, 4, 11), spots(1600, 6, 14) * 0.8)
    shade = fbm(20, 4)
    rgb = tint('#3f7a2e', 0.55 + 0.65 * leaves * (0.6 + 0.5 * shade))
    rgb = rgb + np.array([0.05, 0.08, 0.0]) * (leaves > 0.7)[..., None]
    save(out, 'hedge', rgb, leaves * 0.8 + shade * 0.4, 6.0)


def tarp(out):
    folds = gaussian_filter(rng.standard_normal((N, N)), (40, 8), mode='wrap')
    folds = (folds - folds.min()) / (folds.max() - folds.min())
    weave = noise(0.6)
    rgb = tint('#2553a8', 0.7 + 0.45 * folds + 0.05 * (weave - 0.5))
    save(out, 'tarp', rgb, folds + weave * 0.1, 3.0)


def interior(out):
    low = fbm(60, 3)
    rgb = tint('#2a2f38', 0.8 + 0.3 * (low - 0.5))
    save(out, 'interior', rgb)


if __name__ == '__main__':
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    plaster(out, 'plaster_yellow', '#e0b955')
    plaster(out, 'plaster_white', '#ece8df', 0.2)
    concrete(out)
    panels(out)
    metal(out)
    roof(out)
    green_roof(out)
    laterite(out)
    grass(out)
    hedge(out)
    tarp(out)
    interior(out)
