"""Le Gardien de l'EPL : androide humanoide modele par script dans Blender.

On part du X Bot (squelette Mixamo et ses animations, inchanges) :
- combinaison mecanique sombre = surface du X Bot sans la tete, qui suit
  le corps sans jamais s'ouvrir aux articulations ;
- plaques de carrosserie (blanc ceramique et bleu EPL) moulees sur
  l'anatomie : regions du corps selon l'os dominant, bordure erodee pour
  creer les joints de panneaux, coque decalee vers l'exterieur avec rebord ;
- tete humaine sculptee : surface implicite (crane, machoire, pommettes,
  arcades, nez, levres, menton, orbites) projetee sur une icosphere, masque
  facial separe du crane par une rainure, yeux lumineux, capteurs auditifs.

Chaque maillage reste skinne sur le squelette d'origine. Le jeu recable ces
maillages sur les os du Gardien (voir src/actors/Chaser.ts).
Sortie : assets-src/android.glb
"""
import math
import os

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'assets-src', 'guardian.glb')
OUT = os.path.join(ROOT, 'assets-src', 'android.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
ARM = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
BODY = bpy.data.objects['Beta_Surface']
JOINTS = bpy.data.objects['Beta_Joints']
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.parent is None:
        bpy.data.objects.remove(o)
P = 'mixamorig:'


def material(name, color, rough, metal, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = 4
    return m


MAT = {
    'suit': material('suit', (0.02, 0.022, 0.028), 0.5, 0.6),
    'metal': material('metal', (0.3, 0.31, 0.33), 0.3, 1.0),
    'white': material('white', (0.8, 0.8, 0.78), 0.25, 0.0),
    'blue': material('blue', (0.01, 0.06, 0.4), 0.3, 0.3),
    'skin': material('skin', (0.78, 0.74, 0.7), 0.35, 0.0),
    'eye': material('eye', (1, 1, 1), 0.2, 0.0, (1, 0.9, 0.5)),
    'glow': material('glow', (0.1, 0.1, 0.1), 0.3, 0.0, (0.2, 0.85, 1.0)),
}


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = ARM
    obj.matrix_parent_inverse = ARM.matrix_world.inverted()
    return obj


def skin_rigid(obj, bone):
    """Tout le maillage suit un seul os (pieces rigides)."""
    obj.vertex_groups.clear()
    vg = obj.vertex_groups.new(name=P + bone)
    vg.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')
    mod = obj.modifiers.new('arm', 'ARMATURE')
    mod.object = ARM


def apply_mods(obj):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    obj.select_set(False)


def smooth(obj, angle=35):
    for p in obj.data.polygons:
        p.use_smooth = True
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    obj.select_set(False)


# ---------------- Donnees du corps ----------------

def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def bump(x, a, b, edge=0.3):
    e = (b - a) * edge
    return smoothstep(a, a + e, x) * (1 - smoothstep(b - e, b, x))


def reshape(p):
    """Silhouette plus masculine : bassin et cuisses affines, torse elargi."""
    x, y, z = p.x, p.y, p.z
    if z < 1.0 and abs(x) > 0.004:
        cx = math.copysign(0.09, x)
        k = bump(z, 0.5, 1.0) * 0.25 + bump(z, 0.12, 0.5) * 0.08
        x = cx + (x - cx) * (1 - k)
        y = -0.005 + (y + 0.005) * (1 - k * 0.8)
    x *= 1 - 0.1 * bump(z, 0.8, 1.16)
    w = bump(z, 1.18, 1.52) * (1 - smoothstep(0.17, 0.24, abs(x)))
    x *= 1 + 0.07 * w
    y = 0.005 + (y - 0.005) * (1 + 0.05 * w)
    return Vector((x, y, z))


for ob in (BODY, JOINTS):
    m_w = ob.matrix_world
    inv = m_w.inverted()
    for v in ob.data.vertices:
        v.co = inv @ reshape(m_w @ v.co)


mw = BODY.matrix_world
me = BODY.data
groups = {g.index: g.name[len(P):] for g in BODY.vertex_groups}
VPOS = [mw @ v.co for v in me.vertices]
DOM = []
for v in me.vertices:
    if v.groups:
        g = max(v.groups, key=lambda g: g.weight)
        DOM.append((groups[g.group], g.weight))
    else:
        DOM.append(('', 0))


def is_head(vi):
    b, _ = DOM[vi]
    return b in ('Head', 'HeadTop_End', 'LeftEye', 'RightEye')


# ---------------- Combinaison (corps sans la tete) ----------------

suit = BODY.copy()
suit.data = me.copy()
suit.name = 'android_suit'
bpy.context.scene.collection.objects.link(suit)
bm = bmesh.new()
bm.from_mesh(suit.data)
bm.verts.ensure_lookup_table()
dead = [f for f in bm.faces if any(is_head(v.index) for v in f.verts)]
bmesh.ops.delete(bm, geom=dead, context='FACES')
bm.to_mesh(suit.data)
bm.free()
suit.data.materials.clear()
suit.data.materials.append(MAT['suit'])
joints = JOINTS.copy()
joints.data = JOINTS.data.copy()
joints.name = 'android_joints'
bpy.context.scene.collection.objects.link(joints)
# Retire la rotule spherique de la taille (remplacee par les abdominaux).
bm = bmesh.new()
bm.from_mesh(joints.data)
jmw = JOINTS.matrix_world
ball = lambda v: abs((jmw @ v.co).x) < 0.13 and 0.86 < (jmw @ v.co).z < 1.24
bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(ball(v) for v in f.verts)], context='FACES')
bm.to_mesh(joints.data)
bm.free()
joints.data.materials.clear()
joints.data.materials.append(MAT['metal'])


# ---------------- Plaques de carrosserie ----------------

def panel(name, bones, mat, cuts, bone=None, lift=0.006, thick=0.006, min_w=0.3):
    """Plaque moulee sur le corps : region des os voulus, puis decoupe nette
    par des plans (co, n) : on garde le cote n . (p - co) >= 0."""
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    ok = lambda v: DOM[v.index][0] in bones and DOM[v.index][1] >= min_w
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not any(ok(v) for v in f.verts)], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.transform(bm, matrix=mw, verts=bm.verts)
    for co, n in cuts:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=co, plane_no=n, clear_inner=True)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    if not bm.faces:
        bm.free()
        print('panneau vide', name)
        return None
    # Coque decalee vers l'exterieur.
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * lift
    bmesh.ops.transform(bm, matrix=mw.inverted(), verts=bm.verts)
    obj = bpy.data.objects.new(name, bpy.data.meshes.new(name))
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.materials.append(MAT[mat])
    link(obj)
    obj.matrix_world = BODY.matrix_world.copy()
    sol = obj.modifiers.new('sol', 'SOLIDIFY')
    sol.thickness = thick * 100
    sol.offset = -1
    sol.use_rim = True
    sol.use_rim_only = True
    sol.use_even_offset = True
    apply_mods(obj)
    smooth(obj, 40)
    skin_rigid(obj, bone or bones[0])
    return obj


def cut(axis, v, sign):
    """Plan perpendiculaire a un axe : garde axis*sign >= v*sign."""
    co = [0.0, 0.0, 0.0]
    n = [0.0, 0.0, 0.0]
    i = 'xyz'.index(axis)
    co[i] = v
    n[i] = sign
    return (Vector(co), Vector(n))


def band(axis, lo, hi):
    return [cut(axis, lo, 1), cut(axis, hi, -1)]


PANELS = []


def add(*a, **k):
    o = panel(*a, **k)
    if o:
        PANELS.append(o)


# Torse : plastron en deux moities (sternum visible), dos bleu.
for s in (1, -1):
    add(f'chest{s}', ['Spine1', 'Spine2', 'LeftShoulder', 'RightShoulder'], 'white',
        [cut('z', 1.245, 1), cut('z', 1.47, -1), cut('y', -0.02, -1), cut('x', 0.008 * s, s), cut('x', 0.135 * s, -s)], bone='Spine2')
add('back', ['Spine1', 'Spine2', 'LeftShoulder', 'RightShoulder'], 'blue',
    [cut('z', 1.25, 1), cut('z', 1.46, -1), cut('y', 0.02, 1), *band('x', -0.125, 0.125)], bone='Spine2')
add('pelvis_f', ['Hips'], 'white', [*band('z', 0.955, 1.08), cut('y', -0.01, -1)], bone='Hips')
add('cod', ['Hips'], 'blue', [*band('z', 0.87, 0.94), cut('y', -0.02, -1), *band('x', -0.07, 0.07)], bone='Hips', lift=0.008)
add('pelvis_b', ['Hips'], 'blue', [*band('z', 0.965, 1.075), cut('y', 0.02, 1)], bone='Hips')
for s, side in ((1, 'Left'), (-1, 'Right')):
    X = lambda lo, hi, s=s: [cut('x', lo * s, s), cut('x', hi * s, -s)]
    # Epauliere : dome incline sur l'epaule.
    add(f'shoulder{side}', [side + 'Shoulder', side + 'Arm'], 'blue',
        [(Vector((0.16 * s, 0, 1.445)), Vector((0.35 * s, 0, 1)).normalized()), cut('x', 0.12 * s, s), cut('x', 0.27 * s, -s)], bone=side + 'Arm', lift=0.01)
    add(f'upperarm{side}', [side + 'Arm'], 'white', X(0.215, 0.41), bone=side + 'Arm')
    add(f'forearm{side}', [side + 'ForeArm'], 'white', X(0.475, 0.675), bone=side + 'ForeArm')
    add(f'handback{side}', [side + 'Hand'], 'blue', [*X(0.728, 0.795), cut('z', 1.442, 1)], bone=side + 'Hand', lift=0.003, thick=0.004)
    add(f'thigh{side}', [side + 'UpLeg'], 'white', band('z', 0.62, 0.9), bone=side + 'UpLeg')
    add(f'knee{side}', [side + 'Leg', side + 'UpLeg'], 'blue', [*band('z', 0.475, 0.595), cut('y', -0.035, -1)], bone=side + 'Leg', lift=0.012)
    add(f'shin{side}', [side + 'Leg'], 'white', band('z', 0.14, 0.44), bone=side + 'Leg')
    add(f'boot{side}', [side + 'Foot', side + 'ToeBase'], 'blue', [cut('z', 0.02, 1)], bone=side + 'Foot', lift=0.004)


# ---------------- Tete sculptee ----------------

C0 = np.array([0.0, 0.0, 1.675])  # centre de la tete (monde Blender)


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b + (a - b) * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def ell(q, c, r):
    """Distance approchee a un ellipsoide. q : (n,3) en (X, F, U)."""
    p = (q - np.array(c)) / np.array(r)
    k0 = np.linalg.norm(p, axis=1)
    k1 = np.linalg.norm(p / np.array(r), axis=1)
    return k0 * (k0 - 1) / np.maximum(k1, 1e-9)


def capsule(q, a, b, ra, rb):
    a, b = np.array(a), np.array(b)
    pa, ba = q - a, b - a
    h = np.clip((pa @ ba) / (ba @ ba), 0, 1)
    return np.linalg.norm(pa - np.outer(h, ba), axis=1) - (ra + (rb - ra) * h)


def mirror(fn, q, c, *a):
    return np.minimum(fn(q, c, *a), fn(q, (-c[0], c[1], c[2]), *a))


EYE = (0.034, 0.1, -0.012)


def head_sdf(q):
    d = ell(q, (0, -0.01, 0.025), (0.079, 0.112, 0.098))                    # crane
    d = smin(d, ell(q, (0, 0.045, -0.045), (0.064, 0.068, 0.07)), 0.025)    # face et machoire
    d = smin(d, mirror(ell, q, (0.045, 0.0, -0.07), (0.022, 0.045, 0.03)), 0.02)  # angles de la machoire
    d = smin(d, ell(q, (0, 0.093, -0.1), (0.024, 0.02, 0.02)), 0.018)       # menton
    d = smin(d, mirror(ell, q, (0.046, 0.083, -0.02), (0.026, 0.024, 0.02)), 0.016)  # pommettes
    d = smin(d, ell(q, (0, 0.1, 0.012), (0.06, 0.016, 0.014)), 0.016)       # arcades
    # Orbites.
    d = smax(d, -mirror(ell, q, (0.034, 0.113, -0.012), (0.021, 0.016, 0.013)), 0.012)
    # Paupieres.
    d = smin(d, mirror(ell, q, (0.034, 0.1, -0.0035), (0.0155, 0.0122, 0.0075)), 0.004)
    d = smin(d, mirror(ell, q, (0.034, 0.098, -0.0215), (0.014, 0.0115, 0.0048)), 0.004)
    # Nez : arete, pointe, ailes.
    d = smin(d, capsule(q, (0, 0.104, 0.0), (0, 0.128, -0.04), 0.008, 0.011), 0.012)
    d = smin(d, ell(q, (0, 0.126, -0.044), (0.013, 0.012, 0.012)), 0.008)
    d = smin(d, mirror(ell, q, (0.013, 0.113, -0.048), (0.011, 0.01, 0.009)), 0.008)
    # Levres et fente de la bouche.
    d = smin(d, ell(q, (0, 0.112, -0.066), (0.023, 0.011, 0.008)), 0.008)
    d = smin(d, ell(q, (0, 0.108, -0.08), (0.02, 0.011, 0.009)), 0.008)
    d = smax(d, -ell(q, (0, 0.123, -0.0728), (0.021, 0.013, 0.0014)), 0.002)
    return d


def face_region(q):
    """> 0 sur le masque facial, < 0 sur le crane."""
    x, f, u = q[:, 0], q[:, 1], q[:, 2]
    return f - 0.045 - 0.9 * np.maximum(0, u - 0.03) - 1.2 * np.maximum(0, np.abs(x) - 0.05) + 0.4 * np.maximum(0, -u - 0.07)


def build_head():
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=6, radius=1.0)
    dirs = np.array([v.co.normalized()[:] for v in bm.verts])
    # Repere de la tete : X = x, F = -y (avant), U = z.
    D = np.stack([dirs[:, 0], -dirs[:, 1], dirs[:, 2]], 1)
    O = np.array([0, 0.01, -0.01])
    # Surface la plus exterieure le long de chaque rayon.
    ts = np.linspace(0.2, 0.01, 120)
    hit = np.full(len(D), 0.01)
    prev = np.full(len(D), 0.2)
    found = np.zeros(len(D), bool)
    for t in ts:
        inside = (head_sdf(O + D * t) < 0) & ~found
        hit[inside] = t
        found |= inside
        prev[~found] = t
    lo, hi = hit.copy(), np.minimum(hit + 0.2 / 119, 0.2)
    for _ in range(18):
        mid = (lo + hi) / 2
        ins = head_sdf(O + D * mid[:, None]) < 0
        lo = np.where(ins, mid, lo)
        hi = np.where(ins, hi, mid)
    Q = O + D * lo[:, None]
    # Rainure du masque facial.
    reg = face_region(Q)
    groove = np.exp(-(reg / 0.0022) ** 2) * 0.0028
    Q = Q - D * groove[:, None]
    for v, q in zip(bm.verts, Q):
        v.co = Vector((q[0] + C0[0], -q[1] + C0[1], q[2] + C0[2]))
    obj = bpy.data.objects.new('android_head', bpy.data.meshes.new('android_head'))
    bm.to_mesh(obj.data)
    bm.free()
    bpy.context.scene.collection.objects.link(obj)
    dec = obj.modifiers.new('dec', 'DECIMATE')
    dec.ratio = 0.1
    apply_mods(obj)
    obj.data.materials.append(MAT['white'])
    obj.data.materials.append(MAT['skin'])
    for p in obj.data.polygons:
        c = p.center
        q = np.array([[c.x - C0[0], -(c.y - C0[1]), c.z - C0[2]]])
        p.material_index = 1 if face_region(q)[0] > 0 else 0
    smooth(obj, 60)
    world_to_arm(obj)
    skin_rigid(obj, 'Head')
    return obj


def world_to_arm(obj):
    """Place un objet modele en coordonnees monde sous l'armature."""
    mwo = obj.matrix_world.copy()
    obj.parent = ARM
    obj.matrix_parent_inverse = ARM.matrix_world.inverted()
    obj.matrix_world = mwo


def primitive(name, mat, bone, build):
    bm = bmesh.new()
    build(bm)
    obj = bpy.data.objects.new(name, bpy.data.meshes.new(name))
    bm.to_mesh(obj.data)
    bm.free()
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(MAT[mat])
    smooth(obj, 50)
    world_to_arm(obj)
    skin_rigid(obj, bone)
    return obj


head = build_head()
EXTRA = []
for s in (-1, 1):
    ex, ef, eu = EYE
    pos = Vector((s * ex, -ef, C0[2] + eu))

    # Globe sombre et iris lumineux.
    def eye(bm, pos=pos):
        bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=0.0112)
        bmesh.ops.translate(bm, verts=bm.verts, vec=pos)
    EXTRA.append(primitive(f'eye{s}', 'suit', 'Head', eye))

    def iris(bm, pos=pos):
        bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.0052, radius2=0.0046, depth=0.0016)
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
        bmesh.ops.translate(bm, verts=bm.verts, vec=pos + Vector((0, -0.0108, 0)))
    EXTRA.append(primitive(f'iris{s}', 'eye', 'Head', iris))

    # Capteurs auditifs : disque metallique et anneau lumineux.
    def ear(bm, s=s):
        r = bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=0.024, radius2=0.02, depth=0.014)
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2 * s, 3, 'Y'))
        bmesh.ops.translate(bm, verts=bm.verts, vec=(s * 0.077, 0.004, C0[2] - 0.012))
    EXTRA.append(primitive(f'ear{s}', 'metal', 'Head', ear))

    def ring(bm, s=s):
        bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=0.013, radius2=0.013, depth=0.004)
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2 * s, 3, 'Y'))
        bmesh.ops.translate(bm, verts=bm.verts, vec=(s * 0.0845, 0.004, C0[2] - 0.012))
    EXTRA.append(primitive(f'earglow{s}', 'glow', 'Head', ring))

# Abdominaux : noyau sombre et bandes segmentees autour de la taille.
def core(bm):
    bmesh.ops.create_cone(bm, cap_ends=False, segments=24, radius1=0.095, radius2=0.1, depth=0.3)
    bmesh.ops.scale(bm, vec=(1.0, 0.8, 1.0), verts=bm.verts)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, -0.012, 1.1))
EXTRA.append(primitive('abs_core', 'suit', 'Spine', core))
for i, (z, bone, r) in enumerate([(1.045, 'Hips', 0.112), (1.088, 'Spine', 0.112), (1.13, 'Spine', 0.118), (1.172, 'Spine1', 0.124), (1.214, 'Spine1', 0.13)]):
    def ring_abs(bm, z=z, r=r):
        bmesh.ops.create_cone(bm, cap_ends=False, segments=32, radius1=r, radius2=r - 0.006, depth=0.038)
        bmesh.ops.scale(bm, vec=(1.0, 0.84, 1.0), verts=bm.verts)
        bmesh.ops.translate(bm, verts=bm.verts, vec=(0, -0.014, z))
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=-0.007)
    EXTRA.append(primitive(f'abs{i}', 'white', bone, ring_abs))

# Cou : colonne mecanique sombre et cables.
def neck(bm):
    bmesh.ops.create_cone(bm, cap_ends=False, segments=20, radius1=0.05, radius2=0.042, depth=0.17)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0.012, 1.53))
EXTRA.append(primitive('neck', 'suit', 'Neck', neck))
for i, (cx, cy) in enumerate([(-0.03, -0.028), (0.03, -0.028), (-0.046, 0.0), (0.046, 0.0), (0, 0.05)]):
    def cable(bm, cx=cx, cy=cy):
        bmesh.ops.create_cone(bm, cap_ends=False, segments=8, radius1=0.0075, radius2=0.0075, depth=0.15)
        bmesh.ops.translate(bm, verts=bm.verts, vec=(cx, cy + 0.012, 1.53))
    EXTRA.append(primitive(f'cable{i}', 'metal', 'Neck', cable))

for o in (suit, joints):
    o.data.update()

# ---------------- Export ----------------

bpy.data.objects.remove(BODY)
bpy.data.objects.remove(JOINTS)
# Un seul maillage (une primitive par materiau) : peu d'appels de dessin.
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects:
    if o.type == 'MESH':
        o.select_set(True)
bpy.context.view_layer.objects.active = suit
bpy.ops.object.join()
suit.name = 'android'
for o in bpy.data.objects:
    o.select_set(True)
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
print('triangles', tris)
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', use_selection=True, export_animations=False,
    export_skins=True, export_morph=False, export_yup=True,
)
print('androide exporte', OUT)
