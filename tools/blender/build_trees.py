"""Arbres d'ombrage (neem / cailcedrat) modelises par script dans Blender.

Tronc et branches : tubes effiles le long de branches recursives legerement
courbes. Feuillage : cartes texturees (grappes de feuilles avec
transparence) aux extremites, normales orientees vers l'exterieur de la
couronne pour un eclairage doux, couleur de sommet pour l'ombrage interne.
Sortie : assets-src/trees/trees.glb (objets tree_0, tree_1, tree_2).
"""
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
from common import G, make_material, reset_scene  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TEX = os.path.join(ROOT, 'assets-src', 'trees', 'tex')

reset_scene()
scene = bpy.context.scene

bark = bpy.data.materials.new('bark')
bark.use_nodes = True
nt = bark.node_tree
bsdf = nt.nodes['Principled BSDF']
img = nt.nodes.new('ShaderNodeTexImage')
img.image = bpy.data.images.load(os.path.join(TEX, 'bark.jpg'))
nt.links.new(img.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.95

leaves = bpy.data.materials.new('leaves')
leaves.use_nodes = True
nt = leaves.node_tree
bsdf = nt.nodes['Principled BSDF']
img = nt.nodes.new('ShaderNodeTexImage')
img.image = bpy.data.images.load(os.path.join(TEX, 'leaves.png'))
vc = nt.nodes.new('ShaderNodeVertexColor')
vc.layer_name = 'Col'
mix = nt.nodes.new('ShaderNodeMix')
mix.data_type = 'RGBA'
mix.blend_type = 'MULTIPLY'
mix.inputs['Factor'].default_value = 1.0
nt.links.new(img.outputs['Color'], mix.inputs['A'])
nt.links.new(vc.outputs['Color'], mix.inputs['B'])
nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
nt.links.new(img.outputs['Alpha'], bsdf.inputs['Alpha'])
bsdf.inputs['Roughness'].default_value = 0.8
leaves.use_backface_culling = False


def tube(bm, pts, radii, seg=7):
    """Tube le long d'une polyligne (coordonnees jeu), rayons par point."""
    rings = []
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        a = Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 0, 1))
        u = d.cross(a).normalized()
        v = d.cross(u).normalized()
        ring = []
        for k in range(seg):
            t = 2 * math.pi * k / seg
            q = p + (u * math.cos(t) + v * math.sin(t)) * radii[i]
            ring.append(bm.verts.new(G(q.x, q.y, q.z)))
        rings.append(ring)
    uv_rows = []
    for i in range(len(rings) - 1):
        for k in range(seg):
            j = (k + 1) % seg
            f = bm.faces.new([rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]])
            uv_rows.append((f, i, k))
    return uv_rows


def branch(rnd, start, direction, length, radius, depth, bm_wood, tips, uvs):
    n = 5
    pts, radii = [start], [radius]
    d = direction.normalized()
    p = start.copy()
    for i in range(1, n + 1):
        d = (d + Vector((rnd.uniform(-0.25, 0.25), rnd.uniform(-0.05, 0.2), rnd.uniform(-0.25, 0.25)))).normalized()
        # Les branches s'etalent a l'horizontale en vieillissant (port en parasol).
        if depth >= 1:
            d.y *= 0.85
            d = d.normalized()
        p = p + d * (length / n)
        pts.append(p.copy())
        radii.append(radius * (1 - 0.72 * i / n))
    uvs.extend(tube(bm_wood, pts, radii, seg=7 if depth == 0 else 5))
    if depth >= 3:
        tips.append(p)
        return
    kids = 3 if depth == 0 else rnd.randint(2, 3)
    for c in range(kids):
        ang = 2 * math.pi * c / kids + rnd.uniform(-0.5, 0.5)
        out = Vector((math.cos(ang), 0, math.sin(ang)))
        up = 0.75 if depth == 0 else 0.35
        nd = (d * 0.35 + out * 0.8 + Vector((0, up, 0))).normalized()
        start_at = pts[-1] if depth == 0 else pts[rnd.randint(3, n)]
        branch(rnd, start_at, nd, length * rnd.uniform(0.62, 0.78) * (1.25 if depth == 0 else 1.0), radii[-1] * 1.25, depth + 1, bm_wood, tips, uvs)
        tips.append(start_at + nd * length * 0.4)


def build_tree(name, seed, height=4.0, spread=1.0):
    rnd = random.Random(seed)
    bm_wood = bmesh.new()
    tips, uvs = [], []
    branch(rnd, Vector((0, 0, 0)), Vector((rnd.uniform(-0.1, 0.1), 1, rnd.uniform(-0.1, 0.1))), height, 0.36 * spread, 0, bm_wood, tips, uvs)
    # UV du bois : tour du tube en u, longueur en v.
    uvl = bm_wood.loops.layers.uv.new('UV0')
    for f, i, k in uvs:
        for li, loop in enumerate(f.loops):
            du = 1 if li in (1, 2) else 0
            dv = 1 if li in (2, 3) else 0
            loop[uvl].uv = ((k + du) / 3.0, (i + dv) * 0.5)
    me = bpy.data.meshes.new(name + '_wood')
    bm_wood.to_mesh(me)
    bm_wood.free()
    me.materials.append(bark)
    wood = bpy.data.objects.new(name, me)
    scene.collection.objects.link(wood)
    for p in me.polygons:
        p.use_smooth = True

    # Feuillage : cartes autour des extremites.
    center = Vector((0, 0, 0))
    for t in tips:
        center += t
    center /= max(1, len(tips))
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UV0')
    col = bm.loops.layers.color.new('Col')
    normals = []
    # Enveloppe de la couronne (ellipsoide autour des extremites).
    mn = Vector((min(t.x for t in tips), min(t.y for t in tips), min(t.z for t in tips)))
    mx = Vector((max(t.x for t in tips), max(t.y for t in tips), max(t.z for t in tips)))
    cc = (mn + mx) / 2 + Vector((0, 0.4, 0))
    rad = Vector((max(1.8, (mx.x - mn.x) / 2 + 0.9), max(1.3, (mx.y - mn.y) / 2 + 0.9), max(1.8, (mx.z - mn.z) / 2 + 0.9)))
    centers = []
    for t in tips:
        centers += [t + Vector((rnd.uniform(-0.5, 0.5), rnd.uniform(-0.2, 0.4), rnd.uniform(-0.5, 0.5))) for _ in range(2)]
    while len(centers) < 240:
        # Tirage vers la coque de l'ellipsoide (feuillage surtout en surface).
        d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1) * 0.8 + 0.2, rnd.gauss(0, 1))).normalized()
        k = rnd.uniform(0.55, 1.0) ** 0.5
        centers.append(cc + Vector((d.x * rad.x, d.y * rad.y, d.z * rad.z)) * k)
    for p in centers:
        s = rnd.uniform(1.3, 2.1) * spread
        yaw = rnd.uniform(0, 2 * math.pi)
        tilt = rnd.uniform(-0.9, 0.9)
        ax = Vector((math.cos(yaw), 0, math.sin(yaw)))
        up = Vector((-math.sin(yaw) * math.cos(tilt), math.sin(tilt) * 0.6 + 0.4, math.cos(yaw) * math.cos(tilt))).normalized()
        corners = [p + (-ax - up) * s / 2, p + (ax - up) * s / 2, p + (ax + up) * s / 2, p + (-ax + up) * s / 2]
        q = rnd.randint(0, 3)
        u0, v0 = (q % 2) * 0.5, (q // 2) * 0.5
        quv = [(u0, v0), (u0 + 0.5, v0), (u0 + 0.5, v0 + 0.5), (u0, v0 + 0.5)]
        verts = [bm.verts.new(G(c_.x, c_.y, c_.z)) for c_ in corners]
        f = bm.faces.new(verts)
        for li, loop in enumerate(f.loops):
            loop[uvl].uv = quv[li]
            c_ = corners[li]
            rel = c_ - cc
            e = math.sqrt((rel.x / rad.x) ** 2 + (rel.y / rad.y) ** 2 + (rel.z / rad.z) ** 2)
            k = max(0.4, min(1.05, 0.45 + 0.35 * e + 0.25 * (rel.y / rad.y)))
            loop[col] = (k, k, k * 0.95, 1)
            n = Vector((rel.x / rad.x, rel.y / rad.y + 0.35, rel.z / rad.z)).normalized()
            normals.append(G(n.x, n.y, n.z).normalized())
    me = bpy.data.meshes.new(name + '_leaves')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(leaves)
    # Normales spheriques (eclairage doux du houppier).
    me.normals_split_custom_set(normals)
    lv = bpy.data.objects.new(name + '_leaves', me)
    lv.parent = wood
    scene.collection.objects.link(lv)
    print(name, 'feuilles', len(me.polygons), 'bois', len(wood.data.vertices))
    return wood


for i, (seed, h, s) in enumerate([(3, 2.6, 1.0), (8, 2.3, 0.9), (21, 2.9, 1.1)]):
    t = build_tree(f'tree_{i}', seed, h, s)
    t.location = G(i * 12.0, 0, 0)

# Rendu de controle.
world = bpy.data.worlds.new('W')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.65, 0.9, 1)
sun_d = bpy.data.lights.new('sun', 'SUN')
sun_d.energy = 4
sun = bpy.data.objects.new('sun', sun_d)
sun.rotation_euler = (0.9, 0.3, 0.5)
scene.collection.objects.link(sun)
cam_d = bpy.data.cameras.new('cam')
cam = bpy.data.objects.new('cam', cam_d)
scene.collection.objects.link(cam)
cam.location = G(12, 3.5, -30)
cam.rotation_euler = (G(12, 4.0, 0) - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam_d.lens = 30
scene.camera = cam
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.render.resolution_x = 1000
scene.render.resolution_y = 450
scene.render.filepath = os.path.join(ROOT, 'assets-src', 'trees', 'preview.png')
bpy.ops.render.render(write_still=True)
bpy.data.objects.remove(sun)
bpy.data.objects.remove(cam)
for o in list(scene.collection.objects):
    if o.name.startswith('tree_') and o.parent is None:
        o.location = (0, 0, 0)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(ROOT, 'assets-src', 'trees', 'trees.glb'),
    export_format='GLB', export_image_format='AUTO', export_yup=True,
    export_vertex_color='ACTIVE', export_normals=True,
)
print('arbres exportes')
