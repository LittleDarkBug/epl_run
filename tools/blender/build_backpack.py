"""Cartable d'etudiant modele par script dans Blender (rivaux).

Corps arrondi (cube biseaute + subdivision), poche avant zippee, fermeture
eclair et tirettes, poignee, bretelles rembourrees qui montent sur les
epaules et repartent sous les bras. Trois materiaux : 'bag' (tissu, teinte
par rival dans le jeu), 'trim' (passepoils, bretelles), 'zip' (metal).

Repere : face collee au dos en y = 0, le sac s'etend vers -y (vers l'arriere
du personnage une fois exporte), z vers le haut. Origine au haut du dos.
Sortie : assets-src/backpack.glb
"""
import math
import os

import bpy
import bmesh
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets-src', 'backpack.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color, rough, metal=0.0):
    m = bpy.data.materials.new(name)
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


MAT = {
    'bag': material('bag', (0.8, 0.8, 0.8), 0.75),
    'trim': material('trim', (0.04, 0.045, 0.06), 0.7),
    'zip': material('zip', (0.75, 0.72, 0.68), 0.35, 1.0),
}


def obj_from_bm(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(MAT[mat])
    return o


def apply(o):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    o.select_set(False)


def smooth(o, angle=50):
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    o.select_set(False)


def rounded_box(name, size, center, mat, bevel=0.03, subdiv=2, bulge=0.0):
    """Boite arrondie (biseau + subdivision), face avant legerement bombee."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    o = obj_from_bm(name, bm, mat)
    o.location = center
    bv = o.modifiers.new('bv', 'BEVEL')
    bv.width = bevel
    bv.segments = 3
    sd = o.modifiers.new('sd', 'SUBSURF')
    sd.levels = subdiv
    apply(o)
    if bulge:
        # Bombe la face arriere (tissu rempli).
        for v in o.data.vertices:
            y = v.co.y
            if y < 0:
                k = 1 - min(1, (abs(v.co.x) / (size[0] / 2)) ** 2) * 0.6
                k *= 1 - min(1, (abs(v.co.z) / (size[2] / 2)) ** 2) * 0.6
                v.co.y -= bulge * k
    o.location = center
    smooth(o)
    return o


def tube(name, pts, radius, mat, flat=1.0, seg=8):
    """Tube le long d'une polyligne (bretelles, passepoils, poignee)."""
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    sp = curve.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for p, c in zip(sp.points, pts):
        p.co = (*c, 1)
    curve.bevel_depth = radius
    curve.bevel_resolution = seg // 4
    o = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(o)
    o.scale = (1, 1, 1)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o.select_set(False)
    o.data.materials.clear()
    o.data.materials.append(MAT[mat])
    if flat != 1.0:
        for v in o.data.vertices:
            v.co.y *= flat
    smooth(o, 60)
    return o


def bezier_pts(p0, p1, p2, p3, n=12):
    out = []
    for i in range(n + 1):
        t = i / n
        a = (1 - t) ** 3
        b = 3 * (1 - t) ** 2 * t
        c = 3 * (1 - t) * t * t
        d = t ** 3
        out.append(tuple(p0[k] * a + p1[k] * b + p2[k] * c + p3[k] * d for k in range(3)))
    return out


W, H, D = 0.29, 0.36, 0.13
parts = []
# Corps : collé au dos (y = 0), vers -y.
parts.append(rounded_box('body', (W, D, H), (0, -D / 2 - 0.005, -H / 2), 'bag', bevel=0.045, bulge=0.025))
# Poche avant.
parts.append(rounded_box('pocket', (W * 0.74, 0.06, H * 0.42), (0, -D - 0.035, -H * 0.66), 'bag', bevel=0.02, bulge=0.012))
# Fermeture eclair de la poche (bord haut, sur la face avant bombee).
pz1, px = -H * 0.66 + H * 0.21, W * 0.37
y_p = -D - 0.035 - 0.03 - 0.012
parts.append(tube('zip_pocket', bezier_pts((-px * 0.95, y_p + 0.01, pz1 - 0.012), (-px * 0.4, y_p - 0.004, pz1 - 0.01), (px * 0.4, y_p - 0.004, pz1 - 0.01), (px * 0.95, y_p + 0.01, pz1 - 0.012), 12), 0.0045, 'trim'))
# Fermeture eclair du compartiment principal : sur le dessus, d'un flanc a l'autre.
zip_pts = []
for i in range(17):
    a = math.pi * i / 16
    zip_pts.append((-math.cos(a) * W * 0.5, -D * 0.55, 0.004 - (1 - math.sin(a)) * 0.07))
parts.append(tube('zip_main', zip_pts, 0.0055, 'trim'))
# Fond renforce sombre.
parts.append(rounded_box('base', (W + 0.008, D + 0.008, 0.05), (0, -D / 2 - 0.005, -H + 0.02), 'trim', bevel=0.02, subdiv=1))
# Tirettes.
for x in (-0.05, 0.05):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(0.012, 0.006, 0.03), verts=bm.verts)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(x, y_p - 0.004, pz1 - 0.03))
    parts.append(obj_from_bm(f'pull{x}', bm, 'zip'))
# Poignee sur le dessus.
handle = [(-0.045, -0.035, -0.01), (-0.04, -0.04, 0.04), (0.0, -0.045, 0.06), (0.04, -0.04, 0.04), (0.045, -0.035, -0.01)]
parts.append(tube('handle', handle, 0.009, 'trim'))
# Bretelles : du haut du sac vers les epaules (vers +y, dans le corps), et
# du bas du sac vers les flancs.
for s in (-1, 1):
    top = bezier_pts((s * 0.075, -0.01, -0.02), (s * 0.08, 0.05, 0.07), (s * 0.1, 0.13, 0.06), (s * 0.11, 0.17, -0.02), 12)
    parts.append(tube(f'strap_top{s}', top, 0.018, 'trim', flat=0.45))
    low = bezier_pts((s * 0.12, -0.01, -H + 0.04), (s * 0.15, 0.02, -H + 0.06), (s * 0.16, 0.08, -H + 0.12), (s * 0.15, 0.13, -H + 0.2), 10)
    parts.append(tube(f'strap_low{s}', low, 0.015, 'trim', flat=0.45))
    # Boucle de reglage.
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(0.03, 0.01, 0.018), verts=bm.verts)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(s * 0.135, 0.0, -H + 0.055))
    parts.append(obj_from_bm(f'buckle{s}', bm, 'zip'))

# Un seul objet (une primitive par materiau).
bpy.ops.object.select_all(action='DESELECT')
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
bag = parts[0]
bag.name = 'backpack'
dec = bag.modifiers.new('dec', 'DECIMATE')
dec.ratio = 0.55
apply(bag)
tris = sum(len(p.vertices) - 2 for p in bag.data.polygons)
print('triangles', tris)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=False, export_yup=True)
print('cartable exporte', OUT)
