"""Cacti, rocks and boulders for the synthwave look (?theme=synthwave), where they
stand in for the everyday ones as the palms do for the pines: the same shapes
and sizes, as near-black violet silhouettes lit by neon. The cacti are
faceted, with glowing lines running up their ribs; the rocks and boulders are
faceted stone with every facet edged in neon, like the wireframe mountains.

Blender --background --factory-startup --python scripts/build-synth-props.py
Builds assets/nature/synth-props/synth-props.blend, renders
synth-props-preview.png in a synthwave studio and exports synth-props.glb with
synth-props.json. Each prop is a root at its ground contact (kind and variant
as in endless-nature.glb: the variant it stands in for) holding one
vertex-coloured mesh. In the game bright vertex colours glow (palmMaterial in
nature-models.mjs). All game dimensions use X right, Y up, Z forward; p maps
them to Blender.
"""
import bpy
import math
import random
import json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'nature' / 'synth-props'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
TAU = math.tau

def p(v): return Vector((v[0], -v[2], v[1]))
def mix(a, b, t): return tuple(x * (1 - t) + y * t for x, y in zip(a, b))

# Linear colours: near-black violet bodies (a little lighter on the stone, so
# its facets read) and the palms' neon, which glows in the game.
BODY, STONE = (.022, .01, .04), (.03, .016, .055)
NEON = {'cyan': (.03, .78, 1.0), 'pink': (1.0, .05, .55)}

def surface():
    m = bpy.data.materials.new('Synth_Vertex_Color'); m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bs = nodes['Principled BSDF']; bs.inputs['Roughness'].default_value = .85
    vc = nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Color'
    links.new(vc.outputs['Color'], bs.inputs['Base Color'])
    # The glow, for Blender's own view: bright colours emit, as in the game.
    sep = nodes.new('ShaderNodeSeparateColor'); links.new(vc.outputs['Color'], sep.inputs['Color'])
    m1 = nodes.new('ShaderNodeMath'); m1.operation = 'MAXIMUM'
    links.new(sep.outputs[0], m1.inputs[0]); links.new(sep.outputs[1], m1.inputs[1])
    m2 = nodes.new('ShaderNodeMath'); m2.operation = 'MAXIMUM'
    links.new(m1.outputs[0], m2.inputs[0]); links.new(sep.outputs[2], m2.inputs[1])
    ramp = nodes.new('ShaderNodeMapRange'); ramp.inputs['From Min'].default_value = .3; ramp.inputs['From Max'].default_value = .6
    ramp.inputs['To Max'].default_value = 4.0
    links.new(m2.outputs[0], ramp.inputs['Value'])
    links.new(vc.outputs['Color'], bs.inputs['Emission Color']); links.new(ramp.outputs['Result'], bs.inputs['Emission Strength'])
    return m

MATERIAL = surface()
roots = []; parent = None
def asset(name, loc, kind, variant):
    global parent
    o = bpy.data.objects.new(name, None); bpy.context.collection.objects.link(o); o.location = p(loc)
    o['kind'] = kind; o['variant'] = variant; o['origin'] = 'ground contact'; roots.append(o); parent = o
    return o

# Faces as given (each wound outward), flat shaded, a colour per vertex.
def mesh(name, verts, faces, colors):
    data = bpy.data.meshes.new(name); data.from_pydata([p(v) for v in verts], [], faces); data.update()
    for face in data.polygons: face.use_smooth = False
    o = bpy.data.objects.new(name, data); bpy.context.collection.objects.link(o); o.parent = parent
    data.materials.append(MATERIAL)
    layer = data.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
    for face in data.polygons:
        for loop in face.loop_indices: layer.data[loop].color = (*colors[data.loops[loop].vertex_index], 1)
    return o

class Builder:
    def __init__(self): self.verts, self.faces, self.colors = [], [], []
    def face(self, points, color, outward=None):
        """A polygon; with outward (a point it faces away from), wound to face out."""
        points = [Vector(v) for v in points]
        if outward is not None:
            normal = (points[1] - points[0]).cross(points[2] - points[0])
            centre = sum(points, Vector()) / len(points)
            if normal.dot(centre - Vector(outward)) < 0: points.reverse()
        base = len(self.verts)
        self.verts += [tuple(v) for v in points]; self.colors += [color] * len(points)
        self.faces.append(tuple(range(base, base + len(points))))
    def emit(self, name): return mesh(name, self.verts, self.faces, self.colors)

# --- Cacti ---------------------------------------------------------------
# A faceted tube along a path (eight sides, flat), and a neon line along
# every other edge: a thin strip standing just proud of it, so the cactus
# reads as dark ribs drawn in light.
SIDES = 8
def frames(points):
    out = []
    for j, pos in enumerate(points):
        tangent = (Vector(points[min(j + 1, len(points) - 1)]) - Vector(points[max(0, j - 1)])).normalized()
        ref = Vector((0, 0, 1)) if abs(tangent.z) < .95 else Vector((1, 0, 0))
        u = tangent.cross(ref).normalized(); v = tangent.cross(u).normalized()
        out.append((Vector(pos), u, v))
    return out

def ribbed(builder, points, radii, neon, width):
    rings = frames(points)
    ring = lambda j, k: rings[j][0] + radii[j] * (math.cos(TAU * k / SIDES) * rings[j][1] + math.sin(TAU * k / SIDES) * rings[j][2])
    centre = lambda j: rings[j][0]
    for j in range(len(points) - 1):
        mid = (centre(j) + centre(j + 1)) / 2
        for k in range(SIDES):
            builder.face([ring(j, k), ring(j, k + 1), ring(j + 1, k + 1), ring(j + 1, k)], BODY, outward=mid)
    builder.face([ring(len(points) - 1, k) for k in range(SIDES)], BODY, outward=centre(len(points) - 2))
    for k in range(0, SIDES, 2):
        a = TAU * k / SIDES
        for j in range(len(points) - 1):
            strip = []
            for jj in (j, j + 1):
                pos, u, v = rings[jj]
                out = math.cos(a) * u + math.sin(a) * v; across = -math.sin(a) * u + math.cos(a) * v
                crest = pos + out * (radii[jj] + .012)
                strip.append((crest - across * width / 2, crest + across * width / 2))
            builder.face([strip[0][0], strip[0][1], strip[1][1], strip[1][0]], neon, outward=centre(j) * .5 + centre(j + 1) * .5)

def cactus(name, loc, variant, neon):
    asset(name, loc, 'cactus', variant)
    b = Builder()
    # The same stem and arms as the everyday saguaro and forked cactus
    # (scripts/build-nature.py), so they fill the same room.
    h = 4.42 if variant == 0 else 3.92
    ribbed(b, [(0, 0, 0), (.018, .18, 0), (.03, h * .5, .025), (0, h - .25, .018), (0, h - .09, .018), (0, h, .018)],
           [.36, .365, .337, .30, .235, .05], neon, .05)
    arms = [(-1, 1.55, 1.14, 3.1, .06), (1, 2.34, 1.09, 4.02, -.04)] if variant == 0 else [(-1, 1.34, .85, 2.78, .16), (1, 1.75, 1.08, 3.42, -.07), (1, .83, .54, 1.97, .67)]
    for side, start, width, top, z in arms:
        path = [(side * .24, start, 0), (side * (width - .28), start + .03, z), (side * width, start + .26, z),
                (side * (width + .03), start + .53, z), (side * (width + .03), top - .18, z), (side * (width + .02), top, z)]
        ribbed(b, path, [.21, .233, .235, .233, .206, .04], neon, .04)
    b.emit(name + ' body')

# --- Rocks and boulders --------------------------------------------------
# A broken stone of jittered rings, as the everyday ones, every facet dark
# with a neon line round its edge: each facet is an inset dark face and a
# frame of thin bright strips.
def stone(builder, width, height, depth, seed, offset, neon, line, sides=6, bands=((-.1, .7), (.18, 1.0), (.62, .86), (.92, .42))):
    rng = random.Random(seed)
    angles = [TAU * i / sides + rng.uniform(-.12, .12) for i in range(sides)]
    # The rings rise and fall a little round the stone and its top leans, so
    # the facets break unevenly rather than in level bands.
    lean = (rng.uniform(-.12, .12), rng.uniform(-.12, .12))
    rings = []
    for i, (y, r) in enumerate(bands):
        rise = lambda a: (y + (rng.uniform(-.08, .08) if 0 < i < len(bands) - 1 else 0) + (math.cos(a) * lean[0] + math.sin(a) * lean[1]) * max(0, y)) * height
        rings.append([Vector((math.cos(a) * width * r * rng.uniform(.85, 1.12) + offset[0], rise(a), math.sin(a) * depth * r * rng.uniform(.85, 1.12) + offset[2])) for a in angles])
    centre = Vector((offset[0], height * .4, offset[2]))
    polygons = [[rings[i][k], rings[i][(k + 1) % sides], rings[i + 1][(k + 1) % sides], rings[i + 1][k]] for i in range(len(rings) - 1) for k in range(sides)]
    polygons.append(rings[-1])
    for poly in polygons:
        middle = sum(poly, Vector()) / len(poly)
        inner = [v + (middle - v).normalized() * min(line * 1.5, (middle - v).length * .45) for v in poly]
        shade = .8 + rng.random() * .55
        builder.face(inner, tuple(c * shade for c in STONE), outward=centre)
        for k in range(len(poly)):
            builder.face([poly[k], poly[(k + 1) % len(poly)], inner[(k + 1) % len(poly)], inner[k]], neon, outward=centre)

def rock(name, loc, kind, variant, neon, seed):
    asset(name, loc, kind, variant)
    b = Builder()
    if kind == 'rock':
        stone(b, .86, .60, .67, seed, (0, 0, 0), neon, .03)
        stone(b, .33, .23, .26, seed + 1, (.74, 0, .29), neon, .022, sides=5, bands=((-.1, .75), (.45, 1.0), (.95, .45)))
    else:
        stone(b, 1.0, 1.72, .78, seed, (0, 0, 0), neon, .05)
        stone(b, .38, .34, .3, seed + 1, (.73, 0, .29), neon, .03, sides=5, bands=((-.1, .75), (.45, 1.0), (.95, .45)))
    b.emit(name + ' stone')

cactus('Cactus_Synth_Saguaro', (-4.2, 0, 0), 0, NEON['pink'])
cactus('Cactus_Synth_Forked', (-1.2, 0, .4), 1, NEON['cyan'])
rock('Boulder_Synth_A', (1.9, 0, .2), 'boulder', 0, NEON['cyan'], 722)
rock('Boulder_Synth_B', (4.4, 0, .6), 'boulder', 1, NEON['pink'], 723)
rock('Rock_Synth_A', (.6, 0, 2.6), 'rock', 0, NEON['pink'], 517)
rock('Rock_Synth_B', (3.0, 0, 3.0), 'rock', 1, NEON['cyan'], 518)

# A synthwave studio for the preview: the dusk sky, a striped sun on the
# horizon and the glowing grid underfoot (as for the palms). Never exported.
scene = bpy.context.scene; scene.unit_settings.system = 'METRIC'
scene.render.engine = 'CYCLES'; scene.cycles.samples = 48; scene.cycles.use_denoising = True
scene.render.resolution_x = 1800; scene.render.resolution_y = 1080; scene.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('Synthwave dusk'); scene.world = world; world.use_nodes = True
wn, wl = world.node_tree.nodes, world.node_tree.links
coords = wn.new('ShaderNodeTexCoord'); xyz = wn.new('ShaderNodeSeparateXYZ'); wl.new(coords.outputs['Generated'], xyz.inputs[0])
ramp = wn.new('ShaderNodeValToRGB'); wl.new(xyz.outputs['Z'], ramp.inputs['Fac'])
ramp.color_ramp.elements[0].position = 0; ramp.color_ramp.elements[0].color = (1, .08, .26, 1)
ramp.color_ramp.elements[1].position = .6; ramp.color_ramp.elements[1].color = (.012, .002, .04, 1)
mid = ramp.color_ramp.elements.new(.22); mid.color = (.2, .01, .24, 1)
wl.new(ramp.outputs['Color'], wn['Background'].inputs['Color']); wn['Background'].inputs['Strength'].default_value = 1
def emissive(name, build):
    m = bpy.data.materials.new(name); m.use_nodes = True; n, l = m.node_tree.nodes, m.node_tree.links
    n.remove(n['Principled BSDF']); e = n.new('ShaderNodeEmission'); l.new(e.outputs[0], n['Material Output'].inputs['Surface'])
    build(n, l, e); return m
def sun_nodes(n, l, e):
    tc = n.new('ShaderNodeTexCoord'); s = n.new('ShaderNodeSeparateXYZ'); l.new(tc.outputs['Object'], s.inputs[0])
    r = n.new('ShaderNodeMapRange'); r.inputs['From Min'].default_value = -13; r.inputs['From Max'].default_value = 13; l.new(s.outputs['Y'], r.inputs['Value'])
    c = n.new('ShaderNodeValToRGB'); l.new(r.outputs['Result'], c.inputs['Fac'])
    c.color_ramp.elements[0].color = (1, .03, .3, 1); c.color_ramp.elements[1].color = (1, .8, .1, 1)
    l.new(c.outputs['Color'], e.inputs['Color']); e.inputs['Strength'].default_value = 1.4
bpy.ops.mesh.primitive_circle_add(vertices=96, radius=13, fill_type='NGON', location=p((0, 4, -60)), rotation=(math.pi / 2, 0, 0))
sun = bpy.context.object; sun.name = 'Preview / sun'; sun.data.materials.append(emissive('Preview sun', sun_nodes))
def grid_nodes(n, l, e):
    tc = n.new('ShaderNodeTexCoord'); s = n.new('ShaderNodeSeparateXYZ'); l.new(tc.outputs['Object'], s.inputs[0])
    lines = []
    for axis in ('X', 'Y'):
        scale = n.new('ShaderNodeMath'); scale.operation = 'MULTIPLY'; scale.inputs[1].default_value = .25; l.new(s.outputs[axis], scale.inputs[0])
        frac = n.new('ShaderNodeMath'); frac.operation = 'FRACT'; l.new(scale.outputs[0], frac.inputs[0])
        less = n.new('ShaderNodeMath'); less.operation = 'LESS_THAN'; less.inputs[1].default_value = .03; l.new(frac.outputs[0], less.inputs[0])
        lines.append(less)
    both = n.new('ShaderNodeMath'); both.operation = 'MAXIMUM'; l.new(lines[0].outputs[0], both.inputs[0]); l.new(lines[1].outputs[0], both.inputs[1])
    col = n.new('ShaderNodeMix'); col.data_type = 'RGBA'; l.new(both.outputs[0], col.inputs['Factor'])
    col.inputs['A'].default_value = (.008, .003, .02, 1); col.inputs['B'].default_value = (1, .05, .8, 1)
    l.new(col.outputs['Result'], e.inputs['Color']); e.inputs['Strength'].default_value = 1.6
bpy.ops.mesh.primitive_plane_add(size=240, location=(0, 0, -.02)); floor = bpy.context.object; floor.name = 'Preview / grid'; floor.data.materials.append(emissive('Preview grid', grid_nodes))
def light(name, loc, energy, size, color):
    d = bpy.data.lights.new(name, 'AREA'); d.energy = energy; d.size = size; d.color = color
    o = bpy.data.objects.new(name, d); scene.collection.objects.link(o); o.location = p(loc)
    o.rotation_euler = (p((0, 1.5, 1)) - o.location).to_track_quat('-Z', 'Y').to_euler()
light('Sun rim', (0, 5, -12), 1800, 10, (1, .45, .35)); light('Violet fill', (-5, 7, 10), 700, 10, (.55, .3, 1))
cam_data = bpy.data.cameras.new('Props camera'); cam = bpy.data.objects.new('Props camera', cam_data); scene.collection.objects.link(cam)
cam.location = p((0, 2.3, 11.5)); cam.rotation_euler = (p((0, 1.9, 1)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam_data.lens = 35; scene.camera = cam
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'synth-props.blend'))
scene.render.filepath = str(OUT / 'synth-props-preview.png'); bpy.ops.render.render(write_still=True)

stats = []
for root in roots:
    parts = [o for o in root.children if o.type == 'MESH']
    for o in parts: o.data.calc_loop_triangles()
    stats.append({'name': root.name, 'kind': root['kind'], 'variant': root['variant'], 'triangles': sum(len(o.data.loop_triangles) for o in parts)})
bpy.ops.object.select_all(action='DESELECT')
for root in roots:
    root.select_set(True)
    for o in root.children_recursive: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT / 'synth-props.glb'), export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                          export_extras=True, export_cameras=False, export_lights=False, export_animations=False)
report = {'name': 'Endless Drive / synthwave cacti, rocks and boulders', 'assets': stats, 'axes': 'X right, Y up, Z forward; each asset root is its ground origin',
          'materials': 'opaque vertex colors, no textures; bright (neon) colours glow in the game',
          'variants': 'each stands in for the everyday variant of its kind with the same number'}
(OUT / 'synth-props.json').write_text(json.dumps(report, indent=2) + '\n')
print('SYNTH_PROPS_EXPORT ' + json.dumps(report))
