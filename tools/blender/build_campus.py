"""Modelise le depart du jeu : le batiment de l'EPL (d'apres photos).

Tour d'entree gris-bleu a panneaux avec passage couvert et toit pyramidal
vert, ailes jaunes a deux niveaux (ouvertures a barreaux en retrait,
auvents inclines, poteaux beton, toiture en tole), parking en laterite,
pelouses et haies. Occlusion ambiante cuite par Cycles.

Usage (depuis la racine du projet) :
  <python avec bpy> tools/blender/build_campus.py
Sorties : public/models/campus/campus.glb et ao_*.jpg, plus un rendu de
controle dans assets-src/campus/preview.png.
"""
import math
import os
import random
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
from common import G, Part, bake_ao, lightmap_uvs, make_material, reset_scene  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TEX = os.path.join(ROOT, 'assets-src', 'campus', 'tex')
OUT = os.path.join(ROOT, 'public', 'models', 'campus')
os.makedirs(OUT, exist_ok=True)
FAST = '--fast' in sys.argv
random.seed(4)

reset_scene()
scene = bpy.context.scene
world = bpy.data.worlds.new('World')
scene.world = world

# Constantes partagees avec le jeu (src/world/Campus.ts).
FRONT = 16.0
ROAD_HALF = 4.5
SIDEWALK_OUT = 7.6
TW = ROAD_HALF * 2 + 2.4
TD = 9.0
TH = 13.5

M = {
    'plaster': make_material('plaster', TEX, 'plaster_yellow', tile=2.5, rough=0.9),
    'panel': make_material('panel', TEX, 'panel', tile=2.5, rough=0.8),
    'concrete': make_material('concrete', TEX, 'concrete', tile=2.0, rough=0.88),
    'metal': make_material('metal', TEX, 'metal', tile=1.5, rough=0.55, metal=0.55),
    'roof': make_material('roof', TEX, 'roof', tile=3.0, rough=0.5, metal=0.5),
    'roofgreen': make_material('roofgreen', TEX, 'roof_green', tile=3.0, rough=0.6, metal=0.05),
    'laterite': make_material('laterite', TEX, 'laterite', tile=5.0, rough=0.95),
    'grass': make_material('grass', TEX, 'grass', tile=4.0, rough=0.95),
    'hedge': make_material('hedge', TEX, 'hedge', tile=1.6, rough=0.9),
    'tarp': make_material('tarp', TEX, 'tarp', tile=2.0, rough=0.75),
    'interior': make_material('interior', TEX, 'interior', tile=3.0, rough=0.95, normal=False),
    'teal': make_material('teal', TEX, 'concrete', tile=2.0, factor='#3aa6e8', rough=0.7),
    'signframe': make_material('signframe', TEX, 'metal', tile=1.5, factor='#5a6a8a', rough=0.5, metal=0.4),
}


# ---------------- Tour d'entree ----------------

def build_tower():
    p = Part('tower')
    x0, x1 = -TW / 2, TW / 2
    z0, z1 = FRONT, FRONT + TD
    pier = 1.2
    # Piles du passage.
    for s in (-1, 1):
        xa, xb = (x0, x0 + pier) if s < 0 else (x1 - pier, x1)
        p.box(xa, xb, 0, 4.2, z0 + 0.1, z1, 'panel')
        # Socle beton.
        p.box(xa - 0.05, xb + 0.05, 0, 0.35, z0 + 0.05, z1 + 0.05, 'concrete')
    # Masse haute en retrait, panneaux en saillie devant.
    p.box(x0, x1, 4.2, TH, z0 + 0.1, z1, 'panel')
    # Poutre du passage et plafond.
    p.box(x0 - 0.05, x1 + 0.05, 4.0, 4.55, z0 - 0.05, z0 + 0.6, 'concrete')
    p.box(x0 + pier, x1 - pier, 3.95, 4.2, z0 + 0.1, z1, 'concrete')
    p.box(x0 + pier, x1 - pier, 0.0, 0.06, z0, z1, 'concrete')
    # Panneaux de facade avant (grille 5 x 3) entre la poutre et l'enseigne.
    cols, rows = 5, 3
    top = TH - 2.7
    bot = 4.7
    gw = (x1 - x0 - 0.3) / cols
    gh = (top - bot) / rows
    for i in range(cols):
        for j in range(rows):
            xa = x0 + 0.15 + i * gw + 0.035
            ya = bot + j * gh + 0.035
            p.box(xa, xa + gw - 0.07, ya, ya + gh - 0.07, z0 - 0.02, z0 + 0.12, 'panel')
    # Panneaux des faces laterales.
    for s in (-1, 1):
        xf = x0 if s < 0 else x1
        n = 4
        gz = (TD - 0.4) / n
        for i in range(n):
            for j in range(rows + 1):
                za = z0 + 0.3 + i * gz + 0.035
                ya = 4.7 + j * ((TH - 0.4 - 4.7) / (rows + 1)) + 0.035
                yb = ya + (TH - 0.4 - 4.7) / (rows + 1) - 0.07
                if s < 0:
                    p.box(xf - 0.1, xf + 0.02, ya, yb, za, za + gz - 0.07, 'panel')
                else:
                    p.box(xf - 0.02, xf + 0.1, ya, yb, za, za + gz - 0.07, 'panel')
    # Corniche et toit pyramidal.
    p.box(x0 - 0.35, x1 + 0.35, TH, TH + 0.3, z0 - 0.35, z1 + 0.35, 'concrete')
    bx0, bx1, bz0, bz1 = x0 - 0.2, x1 + 0.2, z0 - 0.2, z1 + 0.2
    apex = (0.0, TH + 3.4, (z0 + z1) / 2)
    y = TH + 0.3
    corners = [(bx0, y, bz0), (bx1, y, bz0), (bx1, y, bz1), (bx0, y, bz1)]
    for k in range(4):
        a, b = corners[k], corners[(k + 1) % 4]
        p.poly([a, b, apex], 'roofgreen')
    p.poly(list(reversed(corners)), 'roofgreen')
    # Cadre de l'enseigne.
    p.box(x0 + 0.3, x1 - 0.3, TH - 2.5, TH - 0.1, z0 - 0.3, z0 - 0.02, 'signframe')
    # Petit panneau bleu au fond du passage.
    p.box(-0.8, 0.8, 2.4, 3.4, z1 - 0.1, z1, 'teal')
    return p.build(bevel=0.02)


def build_sign(logo_path):
    """Enseigne : image du logo sur un plan (face au joueur, vers -z jeu)."""
    m = make_material('sign', TEX, image_path=logo_path, tile=1.0, rough=0.6, emit=0.15)
    m.use_backface_culling = False
    p = Part('sign')
    w = TW - 1.1
    h = w * 460 / 2048
    z = FRONT - 0.31
    y0 = TH - 1.3 - h / 2
    x0 = -w / 2
    p.poly([(x0, y0, z), (x0 + w, y0, z), (x0 + w, y0 + h, z), (x0, y0 + h, z)], 'sign')
    p.mats = [m]
    obj = p.build()
    # UV plein cadre (x inverse : la face est vue depuis -z).
    me = obj.data
    uv = me.uv_layers['UV0']
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = (1 - (co.x - x0) / w, (co.z - y0) / h)
    return obj


# ---------------- Aile jaune ----------------

def build_wing(name, length, floors=2, detail=True):
    """Repere local : facade le long de +x (0..length), tournee vers -z.
    Retourne (corps, barreaux). detail=False : version legere (fond)."""
    p = Part(name)
    bars = Part(name + '_bars')
    fh = 3.6
    H = floors * fh
    depth = 11.0
    bay = 4.0
    nb = max(1, round(length / bay))
    bw = length / nb
    p.box(0, length, 0, H, 0.38, depth, 'plaster')
    for f in range(floors):
        y0 = f * fh
        p.box(0, length, y0, y0 + 1.0, 0.0, 0.38, 'plaster')
        p.box(0, length, y0 + 3.1, y0 + 3.6, 0.0, 0.38, 'plaster')
        p.box(0, length, y0 + 0.95, y0 + 1.05, -0.06, 0.38, 'concrete')
        for i in range(nb):
            xa = i * bw
            mat = 'tarp' if random.random() < 0.35 else 'interior'
            p.box(xa + 0.18, xa + bw - 0.18, y0 + 1.0, y0 + 3.1, 0.34, 0.38, mat)
            if detail:
                n = max(3, round((bw - 0.4) / 0.4))
                for k in range(1, n):
                    x = xa + 0.2 + k * (bw - 0.4) / n
                    bars.box(x - 0.022, x + 0.022, y0 + 1.05, y0 + 3.1, 0.1, 0.144, 'metal')
                for yy in (y0 + 1.1, y0 + 2.1, y0 + 3.05):
                    bars.box(xa + 0.2, xa + bw - 0.2, yy - 0.025, yy + 0.025, 0.09, 0.15, 'metal')
                tilt = Matrix.Translation((xa + bw / 2, y0 + 3.55, 0.0)) @ Matrix.Rotation(math.radians(24), 4, 'X')
                p.box(-bw / 2 + 0.05, bw / 2 - 0.05, -0.035, 0.035, -1.25, 0.05, 'plaster', xf=tilt)
                p.box(-bw / 2 + 0.05, bw / 2 - 0.05, -0.16, 0.035, -1.3, -1.2, 'plaster', xf=tilt)
        for i in range(nb + 1):
            x = i * bw
            p.box(x - 0.18, x + 0.18, y0, y0 + fh, -0.22, 0.38, 'concrete')
    p.box(-0.4, length + 0.4, H, H + 0.14, -1.5, depth + 0.6, 'roof')
    p.box(-0.4, length + 0.4, H - 0.25, H + 0.2, -1.62, -1.45, 'plaster')
    for x in (0.0, length):
        p.box(x - 0.14, x + 0.14, 0, H, -0.3, -0.18, 'teal')
    body = p.build(bevel=0.015 if detail else 0.0)
    bar_obj = bars.build() if detail else None
    return body, bar_obj


# ---------------- Sol et haies ----------------

def build_ground():
    p = Part('ground')
    for s in (-1, 1):
        xa, xb = SIDEWALK_OUT + 0.35, 48.0
        a, b = (-xb, -xa) if s < 0 else (xa, xb)
        p.box(a, b, 0.0, 0.17, -8.0, FRONT + 0.5, 'laterite')
        p.box(a, b, 0.0, 0.16, -26.0, -8.0, 'grass')
    # Esplanade beton devant le passage.
    p.box(-ROAD_HALF - 3.0, ROAD_HALF + 3.0, 0.0, 0.24, FRONT - 3.0, FRONT + 0.2, 'concrete')
    # Cour interieure derriere le passage.
    p.box(-30.0, 30.0, 0.0, 0.1, FRONT + TD, FRONT + 40.0, 'grass')
    return p.build()


def build_hedges():
    p = Part('hedges')
    for s in (-1, 1):
        x = TW / 2 + 1.0
        while x < TW / 2 + 40:
            w = random.uniform(1.6, 2.2)
            h = random.uniform(0.9, 1.15)
            cx = s * (x + w / 2)
            p.box(cx - w / 2, cx + w / 2, 0.15, 0.15 + h, FRONT - 2.2, FRONT - 1.0, 'hedge')
            x += w + 0.05
    return p.build(bevel=0.2, seg=2)


# ---------------- Assemblage ----------------

tower = build_tower()
sign = build_sign(os.path.join(TEX, 'sign.jpg'))
wing, wing_bars = build_wing('wing', 40.0)
wing_l = wing.copy()  # instances : meme maillage place a gauche
wing_l.name = 'wing_left'
scene.collection.objects.link(wing_l)
bars_l = wing_bars.copy()
bars_l.name = 'wing_bars_left'
scene.collection.objects.link(bars_l)
for o in (wing, wing_bars):
    o.location = G(TW / 2, 0, FRONT + 1.0)
for o in (wing_l, bars_l):
    o.location = G(-TW / 2 - 40.0, 0, FRONT + 1.0)
back, _ = build_wing('wing_back', 120.0, detail=False)
back.location = G(-60.0, 0, FRONT + 26.0)
ground = build_ground()
hedges = build_hedges()

# Lumiere et ciel pour l'apercu (la cuisson AO ne depend pas de l'eclairage).
world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs['Color'].default_value = (0.55, 0.62, 0.85, 1)
bg.inputs['Strength'].default_value = 0.7
sun_data = bpy.data.lights.new('sun', 'SUN')
sun_data.energy = 4.0
sun_data.color = (1.0, 0.82, 0.62)
sun_data.angle = math.radians(2)
sun = bpy.data.objects.new('sun', sun_data)
scene.collection.objects.link(sun)
# Direction du soleil du jeu : SUN_DIR = (-0.55, 0.26, -0.8) (vers la lumiere).
d = G(-0.55, 0.26, -0.8).normalized()
sun.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()

# UV de cuisson et occlusion ambiante.
bake_list = [(tower, 1024), (wing, 2048), (back, 1024), (ground, 1024), (hedges, 512)]
if FAST:
    bake_list = []
for obj, size in bake_list:
    lightmap_uvs(obj)
for obj, size in bake_list:
    bake_ao(obj, size, os.path.join(OUT, f'ao_{obj.name}.jpg'), samples=16 if FAST else 32)

# Rendu de controle depuis la camera du menu.
cam_data = bpy.data.cameras.new('cam')
cam_data.lens = 24
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
cam.location = G(-6.0, 3.0, -6.0)
target = G(0.0, 5.0, FRONT)
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.render.resolution_x = 900
scene.render.resolution_y = 700
scene.render.filepath = os.path.join(ROOT, 'assets-src', 'campus', 'preview.png')
bpy.ops.render.render(write_still=True)

# Export glTF (le soleil et la camera ne sont pas exportes).
for o in (sun, cam):
    bpy.data.objects.remove(o)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(ROOT, 'assets-src', 'campus', 'campus.glb'),
    export_format='GLB',
    export_image_format='JPEG',
    export_texcoords=True,
    export_normals=True,
    export_yup=True,
    export_apply=True,
)
print('export termine')
