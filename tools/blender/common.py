"""Outils communs pour modeliser le decor dans Blender par script.

Convention : on decrit tout en coordonnees du jeu (x a droite, y en haut,
z vers l'arriere de la camera ; le joueur court vers -z). Conversion vers
Blender : (x, y, z) jeu -> (x, -z, y). L'export glTF (+Y en haut) retombe
exactement sur les coordonnees du jeu.
"""
import math
import os
import bpy
import bmesh
from mathutils import Matrix, Vector


def G(x, y, z):
    return Vector((x, -z, y))


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# ---------------- Materiaux ----------------

MATS = {}


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_lin(h):
    h = h.lstrip('#')
    return tuple(srgb_to_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


def make_material(name, tex_dir, tex=None, tile=2.0, factor='#ffffff', rough=0.85, metal=0.0, normal=True, image_path=None, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    f = hex_lin(factor)
    bsdf.inputs['Base Color'].default_value = (*f, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'UV0'
    path = image_path or (os.path.join(tex_dir, tex + '.jpg') if tex else None)
    if path:
        img = nt.nodes.new('ShaderNodeTexImage')
        img.image = bpy.data.images.load(path, check_existing=True)
        nt.links.new(uv.outputs['UV'], img.inputs['Vector'])
        if factor.lower() != '#ffffff':
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1.0
            nt.links.new(img.outputs['Color'], mix.inputs['A'])
            mix.inputs['B'].default_value = (*f, 1)
            nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
        else:
            nt.links.new(img.outputs['Color'], bsdf.inputs['Base Color'])
        if emit > 0:
            nt.links.new(img.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = emit
        npath = os.path.join(tex_dir, tex + '_n.jpg') if tex else None
        if normal and npath and os.path.exists(npath):
            nimg = nt.nodes.new('ShaderNodeTexImage')
            nimg.image = bpy.data.images.load(npath, check_existing=True)
            nimg.image.colorspace_settings.name = 'Non-Color'
            nt.links.new(uv.outputs['UV'], nimg.inputs['Vector'])
            nm = nt.nodes.new('ShaderNodeNormalMap')
            nm.uv_map = 'UV0'
            nm.inputs['Strength'].default_value = 0.8
            nt.links.new(nimg.outputs['Color'], nm.inputs['Color'])
            nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    m['tile'] = tile
    m.use_backface_culling = True  # export glTF en simple face
    MATS[name] = m
    return m


# ---------------- Construction de maillages ----------------

class Part:
    """Accumule des primitives (en coordonnees jeu) dans un seul maillage."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def mat_index(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def _face(self, verts, mi):
        f = self.bm.faces.new(verts)
        f.material_index = mi
        return f

    def box(self, x0, x1, y0, y1, z0, z1, mat, xf=None):
        """Boite alignee (bornes jeu). xf : Matrix appliquee en coordonnees jeu."""
        mi = self.mat_index(mat)
        c = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
        pts = []
        for p in c:
            v = Vector(p)
            if xf is not None:
                v = xf @ v
            pts.append(self.bm.verts.new(G(*v)))
        idx = lambda x, y, z: x * 4 + y * 2 + z
        quads = [
            (idx(0, 0, 0), idx(0, 0, 1), idx(0, 1, 1), idx(0, 1, 0)),
            (idx(1, 0, 0), idx(1, 1, 0), idx(1, 1, 1), idx(1, 0, 1)),
            (idx(0, 0, 0), idx(1, 0, 0), idx(1, 0, 1), idx(0, 0, 1)),
            (idx(0, 1, 0), idx(0, 1, 1), idx(1, 1, 1), idx(1, 1, 0)),
            (idx(0, 0, 0), idx(0, 1, 0), idx(1, 1, 0), idx(1, 0, 0)),
            (idx(0, 0, 1), idx(1, 0, 1), idx(1, 1, 1), idx(0, 1, 1)),
        ]
        for q in quads:
            self._face([pts[i] for i in q], mi)

    def boxc(self, cx, cy, cz, sx, sy, sz, mat, xf=None):
        self.box(cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, cz - sz / 2, cz + sz / 2, mat, xf)

    def cyl_y(self, cx, cz, y0, y1, r, mat, seg=8):
        """Cylindre vertical."""
        mi = self.mat_index(mat)
        bot, top = [], []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            bot.append(self.bm.verts.new(G(cx + math.cos(a) * r, y0, cz + math.sin(a) * r)))
            top.append(self.bm.verts.new(G(cx + math.cos(a) * r, y1, cz + math.sin(a) * r)))
        for i in range(seg):
            j = (i + 1) % seg
            self._face([bot[i], bot[j], top[j], top[i]], mi)
        self._face(list(reversed(bot)), mi)
        self._face(top, mi)

    def poly(self, pts, mat):
        mi = self.mat_index(mat)
        self._face([self.bm.verts.new(G(*p)) for p in pts], mi)

    def build(self, bevel=0.0, seg=2, collection=None, drop_bottom=True):
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        if drop_bottom:
            # Faces tournees vers le bas posees au sol : jamais visibles.
            dead = [f for f in self.bm.faces if f.normal.z < -0.99 and max(v.co.z for v in f.verts) < 0.02]
            bmesh.ops.delete(self.bm, geom=dead, context='FACES')
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(MATS[m] if isinstance(m, str) else m)
        obj = bpy.data.objects.new(self.name, me)
        (collection or bpy.context.scene.collection).objects.link(obj)
        if bevel > 0:
            mod = obj.modifiers.new('bevel', 'BEVEL')
            mod.width = bevel
            mod.segments = seg
            mod.limit_method = 'ANGLE'
            mod.angle_limit = math.radians(40)
            mod.harden_normals = True
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            bpy.ops.object.modifier_apply(modifier='bevel')
            obj.select_set(False)
        world_uvs(obj)
        return obj


def world_uvs(obj):
    """UV0 : projection par face selon l'axe dominant, a l'echelle du monde
    (tuile en metres definie par materiau). Textures sans deformation."""
    me = obj.data
    if 'UV0' not in me.uv_layers:
        me.uv_layers.new(name='UV0')
    uv = me.uv_layers['UV0']
    mw = obj.matrix_world
    for poly in me.polygons:
        tile = me.materials[poly.material_index].get('tile', 2.0) if me.materials else 2.0
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            co = mw @ me.vertices[me.loops[li].vertex_index].co
            # Blender : x, y (=-z jeu), z (=y jeu, hauteur)
            if ax == 2:
                u, v = co.x, co.y
            elif ax == 0:
                u, v = co.y * (1 if n[0] > 0 else -1), co.z
            else:
                u, v = co.x * (-1 if n[1] > 0 else 1), co.z
            uv.data[li].uv = (u / tile, v / tile)


def lightmap_uvs(obj, margin=0.15):
    me = obj.data
    if 'AO' not in me.uv_layers:
        me.uv_layers.new(name='AO')
    me.uv_layers.active = me.uv_layers['AO']
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.uv.lightmap_pack(PREF_CONTEXT='ALL_FACES', PREF_PACK_IN_ONE=True, PREF_NEW_UVLAYER=False, PREF_MARGIN_DIV=margin)
    me.uv_layers.active = me.uv_layers['UV0']
    obj.select_set(False)


def bake_ao(obj, size, out_path, samples=24, distance=1.6):
    """Cuit l'occlusion ambiante de l'objet (avec toute la scene) dans une image."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.world.light_settings.distance = distance
    img = bpy.data.images.new('AO_' + obj.name, size, size, alpha=False)
    img.generated_color = (1, 1, 1, 1)
    nodes = []
    for m in obj.data.materials:
        n = m.node_tree.nodes.new('ShaderNodeTexImage')
        n.image = img
        m.node_tree.nodes.active = n
        nodes.append((m, n))
    me = obj.data
    me.uv_layers.active = me.uv_layers['AO']
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type='AO', margin=6, use_clear=True)
    me.uv_layers.active = me.uv_layers['UV0']
    for m, n in nodes:
        m.node_tree.nodes.remove(n)
    img.filepath_raw = out_path
    img.file_format = 'JPEG'
    scene.render.image_settings.quality = 88
    img.save()
    obj.select_set(False)
    print('AO cuite :', obj.name, out_path)
    return img
