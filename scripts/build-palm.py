"""Palm trees for the synthwave look (?theme=synthwave), where they grow in place
of the pines: a tall palm, a leaning one and a young one (for the stunted pines
at the treeline). Near-black violet silhouettes with ringed trunks and
coconuts, their fronds' leaflets running out to neon tips (cyan or hot pink)
that the game makes glow.

Blender --background --factory-startup --python scripts/build-palm.py
Builds assets/nature/palm-synthwave/palm-trees.blend, renders palm-preview.png
in a synthwave studio and exports palm-trees.glb with palm-trees.json. Like the
pines in endless-nature.glb, each palm is a root at its ground contact holding
six vertex-coloured sections (<root>_Part_0 to 5): the trunk in three,
then the fronds in three groups, so it breaks apart on impact. Each also has a
far version (<root>_Far), drawn past 260-340 m: the same trunk and fronds in
about 60 triangles, each frond one folded blade coloured as its leaflets are.
All game dimensions use X right, Y up, Z forward; p maps them to Blender.
"""
import bpy
import bmesh
import math
import random
import json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'nature' / 'palm-synthwave'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
TAU = math.tau

def p(v): return Vector((v[0], -v[2], v[1]))
def mix(a, b, t): return tuple(x * (1 - t) + y * t for x, y in zip(a, b))

# Linear colours. The bodies are near-black violet, lit a little by the scene;
# the frond tips carry the neon. In the game a vertex colour this bright
# glows (see palm-model.mjs), so the crowns read as neon against the dusk.
TRUNK, BAND, FROND, NUT = (.03, .014, .044), (.07, .03, .082), (.018, .007, .036), (.045, .016, .036)
NEON = {'cyan': (.03, .78, 1.0), 'pink': (1.0, .05, .55)}

def surface():
    m = bpy.data.materials.new('Palm_Vertex_Color'); m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bs = nodes['Principled BSDF']; bs.inputs['Roughness'].default_value = .9
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
def asset(name, loc, variant):
    global parent
    o = bpy.data.objects.new(name, None); bpy.context.collection.objects.link(o); o.location = p(loc)
    o['kind'] = 'tree'; o['variant'] = variant; o['origin'] = 'ground contact'; roots.append(o); parent = o
    return o

# A closed solid with a colour per vertex; normals face outward. Nothing
# reaches below the ground contact.
def mesh(name, verts, faces, colors, section):
    verts = [(v[0], max(0, v[1]), v[2]) for v in verts]
    data = bpy.data.meshes.new(name); data.from_pydata([p(v) for v in verts], [], faces); data.update()
    bm = bmesh.new(); bm.from_mesh(data); bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)); bm.to_mesh(data); bm.free()
    o = bpy.data.objects.new(name, data); bpy.context.collection.objects.link(o); o.parent = parent
    o['fragment'] = section; data.materials.append(MATERIAL)
    layer = data.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
    for face in data.polygons:
        for loop in face.loop_indices: layer.data[loop].color = (*colors[data.loops[loop].vertex_index], 1)
    return o

# Rings along a spine (tangent frames), closed at both ends.
def tube(name, points, radii, colors, section, n=8):
    verts, cols = [], []
    for j, (pos, r) in enumerate(zip(points, radii)):
        tangent = (Vector(points[min(j + 1, len(points) - 1)]) - Vector(points[max(0, j - 1)])).normalized()
        ref = Vector((0, 0, 1)) if abs(tangent.z) < .95 else Vector((1, 0, 0))
        u = tangent.cross(ref).normalized(); v = tangent.cross(u).normalized()
        for i in range(n):
            a = TAU * i / n
            verts.append(tuple(Vector(pos) + r * (math.cos(a) * u + math.sin(a) * v))); cols.append(colors[j])
    faces = [tuple(reversed(range(n)))]
    for j in range(len(points) - 1):
        for i in range(n): faces.append((j * n + i, j * n + (i + 1) % n, (j + 1) * n + (i + 1) % n, (j + 1) * n + i))
    faces.append(tuple((len(points) - 1) * n + i for i in range(n)))
    return mesh(name, verts, faces, cols, section)

def nut(name, center, radius, section):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=1, radius=radius)
    verts = [tuple(Vector(center) + Vector((v.co.x, v.co.z * 1.15, v.co.y))) for v in bm.verts]
    faces = [tuple(v.index for v in f.verts) for f in bm.faces]; bm.free()
    return mesh(name, verts, faces, [NUT] * len(verts), section)

def palm(name, loc, variant, height, lean, radius, fronds, length, neon, seed):
    asset(name, loc, variant)
    rng = random.Random(seed)
    far_verts, far_faces, far_colors = [], [], []
    top_r = radius * .58
    def spine(t): return Vector((lean * height * t ** 1.8, height * t, .05 * height * math.sin(t * 4.1) * t))
    def r_at(t): return radius + (top_r - radius) * t
    # The trunk: stacked segments, each flaring at its top and the next
    # starting narrower, so it reads as ringed. Three closed sections, the
    # first with the root flare; six-sided, as its rings break up the outline.
    segments = 8 if height > 5 else 5
    cut = [0, segments // 3, 2 * segments // 3, segments]
    for section in range(3):
        points, radii, colors = [], [], []
        if section == 0:
            for t, r in ((0, radius * 1.7), (.015, radius * 1.3), (.04, radius * 1.05)):
                points.append(tuple(spine(t))); radii.append(r); colors.append(TRUNK)
        for k in range(cut[section], cut[section + 1]):
            t0 = .05 + .95 * k / segments; t1 = .05 + .95 * (k + 1) / segments
            # A section starts level with the top of the one below, leaving no slit.
            start = t0 - .01 if k == cut[section] and section else t0 + .004
            points.append(tuple(spine(start))); radii.append(r_at(t0) * .9); colors.append(TRUNK)
            points.append(tuple(spine(t1 - .01))); radii.append(r_at(t1) * 1.1); colors.append(BAND)
        tube('Trunk section %d' % section, points, radii, colors, section, n=6)
    top = spine(1.0)
    # The crown shaft: a smooth swelling where the fronds spring from.
    tube('Crown shaft', [tuple(top + Vector((0, -.05, 0))), tuple(top + Vector((0, .2, 0))), tuple(top + Vector((0, .38, 0)))],
         [top_r * 1.05, top_r * 1.25, top_r * .55], [TRUNK, BAND, FROND], 2, n=8)
    for i in range(3 if height > 5 else 2):
        a = i * TAU / 3 + .4
        nut('Coconut', tuple(top + Vector((math.cos(a) * top_r * 1.5, -.12 - (i % 2) * .1, math.sin(a) * top_r * 1.5))), top_r * .62, 2)
    # Fronds: two whorls, the upper arching up, the lower spreading and
    # drooping. Each is a midrib with a row of slender leaflets either side,
    # hanging in a V and swept toward the frond's end, dark at the rib and
    # running out to neon tips, brighter toward the frond's end. A leaflet is
    # one triangle, seen from both sides (the game draws palms double-sided):
    # palms are drawn by the thousand, and their cost on the GPU follows their
    # triangle count, so each leaflet is as few as it can be.
    for i in range(fronds):
        upper = i % 2 == 0
        yaw = i * TAU / fronds + rng.uniform(-.18, .18)
        pitch = rng.uniform(.55, .85) if upper else rng.uniform(.0, .28)
        droop = rng.uniform(.55, .75) if upper else rng.uniform(.8, 1.05)
        L = length * (rng.uniform(.82, .95) if upper else rng.uniform(.95, 1.08))
        start = top + Vector((0, .3, 0))
        d0 = Vector((math.cos(yaw) * math.cos(pitch), math.sin(pitch), math.sin(yaw) * math.cos(pitch)))
        def P(s): return start + d0 * (L * s) + Vector((0, -droop * L * s * s, 0))
        def T(s): return (d0 * L + Vector((0, -2 * droop * L * s, 0))).normalized()
        section = 3 + i % 3
        steps = 4
        tube('Frond %d midrib' % i, [tuple(P(k / steps)) for k in range(steps + 1)],
             [.05 * (1 - .75 * k / steps) for k in range(steps + 1)], [FROND] * (steps + 1), section, n=3)
        verts, faces, colors = [], [], []
        pairs = 12 if height > 5 else 9
        for k in range(pairs):
            s = .08 + .88 * (k + .5) / pairs; ds = .88 / pairs
            tangent = T(s); across = tangent.cross(Vector((0, 1, 0))).normalized()
            width = L * .3 * math.sin(math.pi * min(1, s * 1.06)) ** .6
            glow = .45 + .55 * s
            a, b = P(s - ds * .3), P(s + ds * .3)
            left, right = (P(s) + across * side * width * .9 + Vector((0, -width * .7, 0)) + tangent * width * .5 for side in (-1, 1))
            base = len(verts)
            verts += [tuple(a), tuple(b), tuple(left), tuple(right)]
            colors += [FROND, FROND, mix(FROND, neon, glow), mix(FROND, neon, glow)]
            A, B, Lt, Rt = range(base, base + 4)
            faces += [(A, B, Lt), (B, A, Rt)]
        mesh('Frond %d leaflets' % i, verts, faces, colors, section)
        # Far away the frond is one blade folded down along its rib: from its
        # base out to its widest just before the middle of its arc, and in to
        # its tip. Its edges reach about half as far as the leaflets there
        # (they have gaps between them); it is darker than they are (a broad
        # blade catches more of the sky's light) and only tinged with neon
        # toward its edges and tip: what the leaflets average to from afar.
        dark = tuple(c * .6 for c in FROND)
        tangent = T(.45); across = tangent.cross(Vector((0, 1, 0))).normalized(); width = L * .3 * .55 * math.sin(math.pi * .45) ** .6
        base = len(far_verts)
        far_verts += [tuple(P(.08)), tuple(P(.45))] + [tuple(P(.45) + across * side * width * .9 + Vector((0, -width * .7, 0)) + tangent * width * .5) for side in (-1, 1)] + [tuple(P(1))]
        far_colors += [dark, dark, mix(dark, neon, .36), mix(dark, neon, .36), mix(dark, neon, .34)]
        B, C, Lt, Rt, Tp = range(base, base + 5)
        far_faces += [(B, Lt, C), (C, Lt, Tp), (B, C, Rt), (C, Tp, Rt)]
    # The far trunk: four sides, bending with the spine; the crown hides its top.
    base = len(far_verts)
    for t, r in ((0, radius * 1.2), (.5, r_at(.5)), (1, top_r)):
        centre = spine(t)
        for k in range(4):
            a = k * TAU / 4 + TAU / 8
            far_verts.append(tuple(centre + Vector((math.cos(a) * r, 0, math.sin(a) * r)))); far_colors.append(mix(TRUNK, BAND, .4))
    for ring in range(2):
        for k in range(4):
            a, b = base + ring * 4 + k, base + ring * 4 + (k + 1) % 4
            far_faces += [(a, b, b + 4), (a, b + 4, a + 4)]
    asset(name + '_Far', loc, variant); parent['kind'] = 'standin'
    mesh('Far palm', far_verts, far_faces, far_colors, 0).hide_render = True  # it stands inside the palm

palm('Palm_Tall', (-5.5, 0, 0), 6, 8.2, .1, .27, 10, 4.2, NEON['cyan'], 4401)
palm('Palm_Leaning', (0, 0, 0), 7, 7.2, .34, .26, 9, 3.9, NEON['pink'], 4402)
palm('Palm_Young', (5.2, 0, 0), 8, 3.6, .08, .2, 8, 2.6, NEON['cyan'], 4403)

# A synthwave studio for the preview: the dusk sky, a striped sun on the
# horizon and the glowing grid underfoot. Never exported.
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
sun_mat = emissive('Preview sun', sun_nodes)
bpy.ops.mesh.primitive_circle_add(vertices=96, radius=13, fill_type='NGON', location=p((0, 7, -60)), rotation=(math.pi / 2, 0, 0))
sun = bpy.context.object; sun.name = 'Preview / sun'; sun.data.materials.append(sun_mat)
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
grid_mat = emissive('Preview grid', grid_nodes)
bpy.ops.mesh.primitive_plane_add(size=240, location=(0, 0, -.02)); floor = bpy.context.object; floor.name = 'Preview / grid'; floor.data.materials.append(grid_mat)
def light(name, loc, energy, size, color):
    d = bpy.data.lights.new(name, 'AREA'); d.energy = energy; d.size = size; d.color = color
    o = bpy.data.objects.new(name, d); scene.collection.objects.link(o); o.location = p(loc)
    o.rotation_euler = (p((0, 4, 0)) - o.location).to_track_quat('-Z', 'Y').to_euler()
light('Sun rim', (0, 6, -14), 2600, 10, (1, .45, .35)); light('Violet fill', (-6, 9, 12), 900, 10, (.55, .3, 1))
cam_data = bpy.data.cameras.new('Palm camera'); cam = bpy.data.objects.new('Palm camera', cam_data); scene.collection.objects.link(cam)
cam.location = p((0, 3.2, 17)); cam.rotation_euler = (p((0, 5.4, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam_data.lens = 32; scene.camera = cam
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'palm-trees.blend'))
scene.render.filepath = str(OUT / 'palm-preview.png'); bpy.ops.render.render(write_still=True)

# Export: each palm's meshes joined by section, as the pines are.
stats = []
for root in roots:
    buckets = {}
    for o in [o for o in root.children_recursive if o.type == 'MESH']: buckets.setdefault(o['fragment'], []).append(o)
    for section, objects in sorted(buckets.items()):
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects: o.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]; bpy.ops.object.join()
        bpy.context.object.name = '%s_Part_%d' % (root.name, section)
    parts = [o for o in root.children if o.type == 'MESH']
    for o in parts: o.data.calc_loop_triangles()
    stats.append({'name': root.name, 'kind': root['kind'], 'variant': root['variant'], 'triangles': sum(len(o.data.loop_triangles) for o in parts), 'parts': len(parts)})
bpy.ops.object.select_all(action='DESELECT')
for root in roots:
    root.select_set(True)
    for o in root.children_recursive: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT / 'palm-trees.glb'), export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                          export_extras=True, export_cameras=False, export_lights=False, export_animations=False)
report = {'name': 'Endless Drive / synthwave palms', 'assets': stats, 'axes': 'X right, Y up, Z forward; each asset root is its ground origin',
          'materials': 'opaque vertex colors, no textures; bright (neon) colours glow in the game',
          'treeFragments': 'six closed sections per palm: the trunk in three, the fronds in three groups'}
(OUT / 'palm-trees.json').write_text(json.dumps(report, indent=2) + '\n')
print('PALM_EXPORT ' + json.dumps(report))
