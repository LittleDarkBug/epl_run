"""Tenue de l'EPL pour Afi : veste bleu marine, chemise blanche, cravate bleu
marine, boutons dores et ecusson sur la poche de poitrine.

La veste est moulee sur le corps (regions du maillage d'origine, decoupes
nettes par des plans, coque decalee avec epaisseur) et garde les poids de
skinning d'origine : le tissu se deforme avec le corps. Le pantalon jaune
d'origine est reteint en bleu marine uni dans la texture du corps (sa coupe
est retouchee en pantalon de costume dans le jeu, src/actors/tailor.ts).

Sorties : assets-src/uniform.glb (pieces skinnees sur le squelette d'Afi)
          public/models/afi_body.jpg (texture du corps reteinte)
"""
import math
import os

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'assets-src', 'student.glb')
OUT = os.path.join(ROOT, 'assets-src', 'uniform.glb')
TEX_OUT = os.path.join(ROOT, 'public', 'models', 'afi_body.jpg')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
ARM = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
BODY = bpy.data.objects['Ch03']
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.parent is None:
        bpy.data.objects.remove(o)
P = 'mixamorig:'


def material(name, color, rough, metal=0.0):
    m = bpy.data.materials.new(name)
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


MAT = {
    'navy': material('navy', (0.012, 0.018, 0.06), 0.75),
    'shirt': material('shirt', (0.85, 0.86, 0.88), 0.7),
    'tie': material('tie', (0.008, 0.014, 0.05), 0.45),
    'gold': material('gold', (0.8, 0.55, 0.15), 0.3, 1.0),
    'crest': material('crest', (1, 1, 1), 0.6),
}

mw = BODY.matrix_world
me = BODY.data
groups = {g.index: g.name[len(P):] for g in BODY.vertex_groups}
VPOS = [mw @ v.co for v in me.vertices]
DOM = []
for v in me.vertices:
    g = max(v.groups, key=lambda g: g.weight) if v.groups else None
    DOM.append((groups[g.group], g.weight) if g else ('', 0))


def new_object(name, bm, mat):
    """Objet sous l'armature avec les memes groupes de sommets que le corps."""
    obj = bpy.data.objects.new(name, bpy.data.meshes.new(name))
    for g in BODY.vertex_groups:
        obj.vertex_groups.new(name=g.name)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.materials.append(MAT[mat])
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = ARM
    obj.matrix_parent_inverse = ARM.matrix_world.inverted()
    obj.matrix_world = BODY.matrix_world.copy()
    return obj


def apply_mods(obj):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    obj.select_set(False)


def smooth(obj, angle=50):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    obj.select_set(False)


def region(bones, keep_face, cuts=(), splits=()):
    """Copie des faces du corps (os voulus), decoupes nettes : `cuts` enleve
    un cote d'un plan, `splits` coupe sans rien enlever (bords propres), puis
    `keep_face(centre)` choisit les faces gardees. Travail en coordonnees monde."""
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    ok = lambda v: DOM[v.index][0] in bones
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not any(ok(v) for v in f.verts)], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.transform(bm, matrix=mw, verts=bm.verts)
    for co, n in cuts:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5, plane_co=co, plane_no=n, clear_inner=True)
    for co, n in splits:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5, plane_co=co, plane_no=n)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not keep_face(f.calc_center_median())], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    return bm


def shell(name, bm, mat, lift, thick):
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * lift
    bmesh.ops.transform(bm, matrix=mw.inverted(), verts=bm.verts)
    obj = new_object(name, bm, mat)
    if thick > 0:
        sol = obj.modifiers.new('sol', 'SOLIDIFY')
        sol.thickness = thick * 100
        sol.offset = -1
        sol.use_rim = True
        sol.use_rim_only = True
        sol.use_even_offset = True
    sub = obj.modifiers.new('lisse', 'CORRECTIVE_SMOOTH')
    sub.factor = 0.5
    sub.iterations = 4
    sub.use_only_smooth = True
    apply_mods(obj)
    smooth(obj, 60)
    arm = obj.modifiers.new('arm', 'ARMATURE')
    arm.object = ARM
    return obj


def cut(axis, v, sign):
    co = [0.0, 0.0, 0.0]
    n = [0.0, 0.0, 0.0]
    i = 'xyz'.index(axis)
    co[i] = v
    n[i] = sign
    return (Vector(co), Vector(n))


TORSO = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder',
         'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftUpLeg', 'RightUpLeg']

# Encolure en V : du col (1.315) au premier bouton (1.105), demi-largeur 0.085 en haut.
V_TOP, V_BOT, V_W = 1.315, 1.105, 0.085


def in_v(p, extra=0.0):
    if p.y > 0.0 or p.z < V_BOT - extra or p.z > V_TOP + 0.05:
        return False
    return abs(p.x) < V_W * (p.z - V_BOT) / (V_TOP - V_BOT) + extra


def v_planes():
    """Deux plans inclines qui tracent les bords du V."""
    out = []
    for s in (1, -1):
        # Plan passant par (0, 0, V_BOT) et (s*V_W, 0, V_TOP), vertical en y.
        d = Vector((s * V_W, 0, V_TOP - V_BOT)).normalized()
        n = d.cross(Vector((0, 1, 0))).normalized()
        out.append((Vector((0, 0, V_BOT)), n))
    return out


# ---------------- Veste ----------------

def jacket_face(c):
    if c.z < 0.9 or c.z > 1.335:
        return False
    return not in_v(c)


bm = region(TORSO, jacket_face,
            cuts=[cut('z', 0.9, 1), cut('x', 0.535, -1), cut('x', -0.535, 1), cut('z', 1.335, -1)],
            splits=v_planes() + [cut('z', V_BOT, 1)])
jacket = shell('jacket', bm, 'navy', 0.011, 0.006)

# ---------------- Chemise (V et col) ----------------

def shirt_face(c):
    if in_v(c, 0.012):
        return True
    return 1.29 < c.z < 1.345  # col tout autour du cou


bm = region(['Spine2', 'Spine1', 'Neck', 'LeftShoulder', 'RightShoulder', 'Head'], shirt_face,
            cuts=[cut('z', V_BOT - 0.015, 1), cut('z', 1.345, -1)], splits=[cut('z', 1.29, 1)])
shirt = shell('shirt', bm, 'shirt', 0.006, 0.0)

# ---------------- Cravate ----------------

def front_y(z, x=0.0):
    """Surface avant du corps a la hauteur z (au plus pres de l'axe)."""
    best = None
    for p in VPOS:
        if abs(p.z - z) < 0.01 and abs(p.x - x) < 0.018 and p.y < 0:
            best = p.y if best is None else min(best, p.y)
    return best if best is not None else -0.08


def tie():
    bm = bmesh.new()
    # Profil : (z, demi-largeur).
    prof = [(1.318, 0.016), (1.296, 0.019), (1.285, 0.011), (1.26, 0.017), (1.2, 0.025), (1.14, 0.029), (1.112, 0.03), (1.098, 0.0)]
    rows = []
    for z, w in prof:
        y = front_y(z) - 0.014
        if z > 1.28:
            y -= 0.006  # noeud plus epais
        row = [bm.verts.new((sx * w, y, z)) for sx in (-1, 1)]
        back = [bm.verts.new((sx * w, y + 0.004, z)) for sx in (-1, 1)]
        rows.append((row, back))
    for (a, ab), (b, bb) in zip(rows, rows[1:]):
        bm.faces.new([a[0], a[1], b[1], b[0]])
        bm.faces.new([ab[1], ab[0], bb[0], bb[1]])
        bm.faces.new([a[0], b[0], bb[0], ab[0]])
        bm.faces.new([b[1], a[1], ab[1], bb[1]])
    top, topb = rows[0]
    bm.faces.new([top[1], top[0], topb[0], topb[1]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = bpy.data.objects.new('tie', bpy.data.meshes.new('tie'))
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.materials.append(MAT['tie'])
    bpy.context.scene.collection.objects.link(obj)
    # Poids : Spine2 en haut, Spine1 en bas, transition douce.
    g2 = obj.vertex_groups.new(name=P + 'Spine2')
    g1 = obj.vertex_groups.new(name=P + 'Spine1')
    for v in obj.data.vertices:
        t = min(1.0, max(0.0, (v.co.z - 1.12) / 0.12))
        g2.add([v.index], t, 'REPLACE')
        g1.add([v.index], 1 - t, 'REPLACE')
    mwo = obj.matrix_world.copy()
    obj.parent = ARM
    obj.matrix_parent_inverse = ARM.matrix_world.inverted()
    obj.matrix_world = mwo
    arm = obj.modifiers.new('arm', 'ARMATURE')
    arm.object = ARM
    smooth(obj, 30)
    return obj


tie_obj = tie()


# ---------------- Boutons et ecusson ----------------

def rigid(name, bm, mat, bone):
    obj = bpy.data.objects.new(name, bpy.data.meshes.new(name))
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.materials.append(MAT[mat])
    bpy.context.scene.collection.objects.link(obj)
    vg = obj.vertex_groups.new(name=P + bone)
    vg.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')
    mwo = obj.matrix_world.copy()
    obj.parent = ARM
    obj.matrix_parent_inverse = ARM.matrix_world.inverted()
    obj.matrix_world = mwo
    arm = obj.modifiers.new('arm', 'ARMATURE')
    arm.object = ARM
    smooth(obj, 50)
    return obj


EXTRA = []
for i, z in enumerate((1.085, 1.02)):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=0.0085, radius2=0.0075, depth=0.004)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0.0, front_y(z) - 0.019, z))
    EXTRA.append(rigid(f'button{i}', bm, 'gold', 'Spine'))

# Ecusson : petit ecran de tissu sur la poitrine gauche (cote +x), UV 0..1.
bm = bmesh.new()
uv = bm.loops.layers.uv.new('UV0')
cx, cz, w, h = 0.085, 1.215, 0.06, 0.05
y = front_y(cz, cx) - 0.02
vs = [bm.verts.new((cx - w / 2, y + 0.004, cz - h / 2)), bm.verts.new((cx + w / 2, y + 0.0055, cz - h / 2)),
      bm.verts.new((cx + w / 2, y + 0.0055, cz + h / 2)), bm.verts.new((cx - w / 2, y + 0.004, cz + h / 2))]
f = bm.faces.new(vs)
# Le personnage regarde -y : vu de face, +x est a droite de l'image -> inverser u.
for loop, (u, v) in zip(f.loops, [(1, 0), (0, 0), (0, 1), (1, 1)]):
    loop[uv].uv = (u, v)
if f.normal.y > 0:
    bmesh.ops.reverse_faces(bm, faces=[f])
EXTRA.append(rigid('crest', bm, 'crest', 'Spine2'))

# ---------------- Texture du corps : pantalon jaune -> bleu nuit ----------------

img = next(n.image for n in BODY.data.materials[0].node_tree.nodes if n.type == 'TEX_IMAGE' and 'Diffuse' in n.image.name)
wd, ht = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(ht, wd, 4)
r, g, b = px[..., 0], px[..., 1], px[..., 2]
yellow = (r > 0.45) & (g > 0.35) & (b < 0.45 * g) & (r - b > 0.3)
lum = 0.3 * r + 0.59 * g + 0.11 * b
tint = np.array([0.105, 0.15, 0.27])  # meme bleu marine que la veste (#1a2544)
# Drap de costume : on attenue les gros plis peints du sarouel.
k = (0.95 + 0.2 * (np.clip(lum / 0.8, 0.35, 1.2) - 1))[..., None]
px[..., :3] = np.where(yellow[..., None], tint * k, px[..., :3])
# Bandes decoratives du pantalon (au milieu des zones reteintes) -> uni.
near = yellow.copy()
for _ in range(7):
    near = near | np.roll(near, 1, 0) | np.roll(near, -1, 0) | np.roll(near, 1, 1) | np.roll(near, -1, 1)
cyan = near & (b > 0.55) & (g > 0.5) & (r < 0.45)
# Bandes et revers sombres du sarouel -> meme drap bleu marine (pantalon uni).
dark = near & ~yellow & (lum < 0.25) & (np.abs(r - b) < 0.12)
bluish = near & ~yellow & (b > r + 0.12)
plain = cyan | dark | bluish
px[..., :3] = np.where(plain[..., None], tint * 0.9, px[..., :3])
print('pantalon uni', int(plain.sum()), 'pixels')
cloth = yellow | plain
out = bpy.data.images.new('afi_body', wd, ht)
out.pixels = px.ravel()
out.filepath_raw = TEX_OUT
out.file_format = 'JPEG'
bpy.context.scene.render.image_settings.quality = 92
out.save()
print('texture reteinte', TEX_OUT, int(yellow.sum()), 'pixels')

# Carte rugosite / metal (vert / bleu) : drap mat sur le pantalon.
mr = next(n.image for n in BODY.data.materials[0].node_tree.nodes if n.type == 'TEX_IMAGE' and n.image.name == 'Image')
q = np.array(mr.pixels[:], dtype=np.float32).reshape(ht, wd, 4)
q[..., 1] = np.where(cloth, 0.88, q[..., 1])
q[..., 2] = np.where(cloth, 0.0, q[..., 2])
out2 = bpy.data.images.new('afi_rough', wd, ht)
out2.pixels = q.ravel()
out2.filepath_raw = os.path.join(ROOT, 'public', 'models', 'afi_rough.jpg')
out2.file_format = 'JPEG'
out2.save()

# ---------------- Export ----------------

bpy.data.objects.remove(BODY)
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects:
    if o.type == 'MESH':
        o.select_set(True)
bpy.context.view_layer.objects.active = jacket
bpy.ops.object.join()
jacket.name = 'uniform'
for o in bpy.data.objects:
    o.select_set(True)
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
print('triangles', tris)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=False, export_skins=True, export_yup=True)
print('tenue exportee', OUT)
