"""Build the Roadster (Rocket trim, with cold-gas thrusters) with Blender, then export it.

Run: /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/build-roadster.py
Coordinates below use game axes: X right, Y up, Z forward; p() maps to Blender.
Original geometry studied from Tesla's October 2026 Roadster photographs:
https://www.tesla.com/roadster (front, profile, top, rear, rear-deck, night and
interior views). Revision 4 follows their faceted wedge: flat panels, one
shoulder crease, a black lower body, see-through gold glass over a white
cockpit, and a wing on swan-neck mounts.
Retains the game's 2.82 m wheelbase and tyre envelopes. No downloaded geometry,
photographic textures, badges or lettering are included.
Ten thruster nozzles follow the reported Rocket layout: four in the rear
diffuser, four lift nozzles at the corners and two yaw nozzles on the flanks.
Each nozzle has an Exhaust_* empty at its mouth whose 'thrust' property is the
gas direction (game axes); the game hangs its exhaust plumes there. The rear
wing hangs from its own Rear_Wing pivot, which the game tilts to brake.
"""
import bpy
import bmesh
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'vehicles'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in list(bpy.data.materials):
    bpy.data.materials.remove(block)

WHEELBASE, FRONT_AXLE, REAR_AXLE = 2.82, 1.41, -1.41
# 295/30 R20 front and 335/30 R21 rear: tyre and rim radii, tread widths.
FRONT = dict(radius=.343, rim=.254, width=.295, x=.845)
REAR = dict(radius=.367, rim=.267, width=.335, x=.83)

def p(v):
    return Vector((v[0], -v[2], v[1]))

def mat(name, color, metal=0, rough=.4, emission=0, coat=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Metallic'].default_value = metal
    bs.inputs['Roughness'].default_value = rough
    if emission:
        bs.inputs['Emission Color'].default_value = (*color, 1)
        bs.inputs['Emission Strength'].default_value = emission
    if coat:
        bs.inputs['Coat Weight'].default_value = coat
        bs.inputs['Coat Roughness'].default_value = .18
    return m

paint = mat('Ano_White', (.83, .85, .84), .18, .26, coat=.5)
glass = mat('Gold_Glass', (.065, .043, .018), .5, .19, coat=.65)
# Tinted, not opaque: the white cockpit shows through, as in the photographs.
glass.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = .86
glass.surface_render_method = 'BLENDED'; glass.use_backface_culling = False
carbon = mat('Carbon', (.022, .024, .027), .25, .42)
titanium = mat('Titanium', (.45, .45, .47), .85, .28)
graphite = mat('Wheel_Graphite', (.065, .073, .083), .78, .24)
rubber = mat('Rubber', (.019, .022, .024), 0, .8)
head = mat('Headlamp', (.9, .94, 1), .1, .15, .6)
brake = mat('Brake_Lamp', (.75, .02, .015), .15, .2, .35)
throat = mat('Thruster_Throat', (.012, .012, .014), .3, .85)
caliper = mat('Caliper_Gold', (.61, .34, .075), .75, .29)
lens = mat('Lens_White', (.82, .84, .86), .1, .18)

def empty(name, loc=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.location = p(loc)
    o.parent = parent
    return o

root = empty('Roadster_Rocket')
root['asset'] = 'Roadster Rocket / reference-sculpted Blender model, revision 4'
root['revision'] = 4
root['reference'] = 'https://www.tesla.com/roadster'
root['forward'] = '+Z in glTF'; root['wheelRadius'] = (FRONT['radius'] + REAR['radius']) / 2
body = empty('Body', parent=root)
parent = body

def finish(o, name, material, bevel=0, smooth=True):
    o.name = name
    o.parent = parent
    o.data.materials.append(material)
    if bevel:
        mod = o.modifiers.new('Edge radius', 'BEVEL')
        mod.width = bevel; mod.segments = 1 if bevel < .005 else 3
    if smooth:
        for face in o.data.polygons:
            face.use_smooth = True
        mod = o.modifiers.new('Weighted surface normals', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True; mod.weight = 50
    return o

def box(name, loc, size, material, bevel=.012, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=p(loc))
    o = bpy.context.object
    o.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Game Euler X/Y/Z map to Blender X/Z/-Y.
    o.rotation_euler = (rotation[0], -rotation[2], rotation[1])
    return finish(o, name, material, bevel)

def mesh(name, verts, faces, material, bevel=0, smooth=False):
    m = bpy.data.meshes.new(name)
    m.from_pydata([p(v) for v in verts], [], faces); m.update()
    o = bpy.data.objects.new(name, m); bpy.context.collection.objects.link(o)
    # Consistent outward normals for the lofted shells.
    bm = bmesh.new(); bm.from_mesh(m)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(m); bm.free()
    return finish(o, name, material, bevel, smooth)

def beam(name, a, b, radius, material, vertices=8):
    a, b = p(a), p(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=(b-a).length, location=(a+b)/2)
    o = bpy.context.object; o.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    return finish(o, name, material, 0)

def cylinder(name, loc, radius, depth, material, axis=(1, 0, 0), vertices=32, bevel=.005, caps=True):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=p(loc), end_fill_type='NGON' if caps else 'NOTHING')
    o = bpy.context.object
    o.rotation_euler = p(axis).to_track_quat('Z', 'Y').to_euler()
    return finish(o, name, material, bevel)

def cone(name, loc, r1, r2, depth, material, axis, vertices=20):
    # r1 at the start of the axis direction, r2 at its end.
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r1, radius2=r2, depth=depth, location=p(loc), end_fill_type='NOTHING')
    o = bpy.context.object
    o.rotation_euler = p(axis).to_track_quat('Z', 'Y').to_euler()
    return finish(o, name, material, 0)

def tube(name, points, radius, material):
    c = bpy.data.curves.new(name, 'CURVE'); c.dimensions = '3D'
    c.bevel_depth = radius; c.bevel_resolution = 1; c.resolution_u = 1
    s = c.splines.new('POLY'); s.points.add(len(points)-1)
    for q, v in zip(s.points, points): q.co = (*p(v), 1)
    o = bpy.data.objects.new(name, c); bpy.context.collection.objects.link(o)
    o.parent = parent; c.materials.append(material)
    return o

def loft(name, rings, material, bevel=.015, smooth=True):
    # Closed surface through same-sized cross-section rings (game coordinates).
    n = len(rings[0]); verts = [v for ring in rings for v in ring]; faces = []
    for j in range(len(rings)-1):
        for k in range(n): faces.append((j*n+k, j*n+(k+1)%n, (j+1)*n+(k+1)%n, (j+1)*n+k))
    faces += [tuple(range(n))[::-1], tuple((len(rings)-1)*n+k for k in range(n))]
    return mesh(name, verts, faces, material, bevel, smooth)

def mirrored(z, half):
    # Half profile from the bottom centre round to the top centre (x >= 0),
    # mirrored into a closed ring at station z.
    right = [(x, y, z) for x, y in half]
    left = [(-x, y, z) for x, y in half[-2:0:-1]]
    return right + left

# ---- Body. The car on tesla.com is a faceted wedge: a low, flat bonnet
# between raised fender blades, one sharp shoulder crease from nose to tail and
# a black lower body that rises behind the doors. Each station is a half
# section from the bottom centre round to the top centre:
#   bottom centre, bottom edge, top of the black band, shoulder crease,
#   top edge, ridge, inner edge, inboard, top centre.
# Ahead of the windscreen the ridge is the fender blade and the inner edge the
# bonnet's. In the cabin they are the glazing's base and the cockpit wall, and
# the top drops to the cockpit floor. Behind it they are the rear deck's crease
# and the rear window's edge. Straight lofts between stations give the flat,
# ruled panels of the reference. Over each wheel the top clears the tyre and
# its arch.
STATIONS = [
    (2.24, [(0,.13),(.62,.13),(.70,.40),(.76,.46),(.74,.50),(.70,.505),(.62,.48),(.30,.485),(0,.485)]),
    (2.10, [(0,.11),(.75,.11),(.84,.30),(.88,.55),(.85,.58),(.80,.60),(.63,.53),(.30,.535),(0,.535)]),
    (1.75, [(0,.11),(.85,.11),(.95,.30),(.98,.60),(.94,.66),(.82,.68),(.63,.61),(.30,.62),(0,.62)]),
    (1.41, [(0,.12),(.88,.12),(.97,.30),(1.0,.63),(.96,.74),(.82,.76),(.66,.72),(.30,.70),(0,.70)]),
    (1.05, [(0,.12),(.88,.12),(.97,.30),(1.0,.64),(.96,.75),(.84,.77),(.63,.72),(.30,.725),(0,.725)]),
    (.88, [(0,.12),(.88,.12),(.97,.30),(1.0,.65),(.96,.77),(.92,.775),(.70,.755),(.30,.76),(0,.76)]),
    (.70, [(0,.12),(.88,.12),(.97,.30),(1.0,.65),(.96,.78),(.93,.78),(.86,.74),(.55,.40),(0,.38)]),
    (0, [(0,.13),(.88,.13),(.97,.30),(1.0,.66),(.96,.79),(.93,.79),(.86,.75),(.55,.32),(0,.30)]),
    (-.75, [(0,.14),(.88,.14),(.97,.34),(1.0,.67),(.96,.80),(.93,.80),(.86,.76),(.55,.34),(0,.32)]),
    (-.95, [(0,.14),(.88,.14),(.97,.38),(1.0,.67),(.96,.80),(.92,.81),(.80,.90),(.40,.98),(0,.98)]),
    (-1.25, [(0,.15),(.89,.15),(.97,.42),(1.0,.68),(.97,.80),(.78,.90),(.67,.925),(.34,.97),(0,.97)]),
    (-1.5, [(0,.16),(.90,.16),(.97,.44),(.995,.68),(.97,.78),(.70,.84),(.40,.935),(.20,.925),(0,.925)]),
    (-1.78, [(0,.17),(.90,.17),(.96,.45),(.985,.68),(.96,.70),(.80,.76),(.29,.81),(.15,.80),(0,.80)]),
    (-2.0, [(0,.19),(.88,.19),(.94,.45),(.965,.67),(.94,.68),(.88,.70),(.40,.72),(.20,.72),(0,.72)]),
    (-2.16, [(0,.20),(.85,.20),(.90,.45),(.93,.64),(.92,.66),(.88,.665),(.40,.665),(.20,.665),(0,.665)]),
]
def lerp(a, b, t): return a+(b-a)*t
def section(z):
    for (z0, h0), (z1, h1) in zip(STATIONS, STATIONS[1:]):
        if z1 <= z <= z0:
            t = (z0-z)/(z0-z1)
            return [(lerp(a[0], b[0], t), lerp(a[1], b[1], t)) for a, b in zip(h0, h1)]
    return list(STATIONS[0][1] if z > STATIONS[0][0] else STATIONS[-1][1])
def side_at(z, y, s, offset=.004):
    # The point on the body side (bottom edge up to the top edge) at height y.
    half = section(z)
    for (x0, y0), (x1, y1) in zip(half[1:5], half[2:5]):
        if y0 <= y <= y1: return (s*(lerp(x0, x1, (y-y0)/(y1-y0))+offset), y, z)
    return (s*(half[3][0]+offset), y, z)
def subtract(target, cutter, name):
    bpy.context.view_layer.objects.active=target
    mod=target.modifiers.new(name,'BOOLEAN');mod.operation='DIFFERENCE';mod.object=cutter
    mod.material_mode='TRANSFER'
    for previous in list(target.modifiers): bpy.ops.object.modifier_apply(modifier=previous.name)
    bpy.data.objects.remove(cutter,do_unlink=True)
def top_at(z, x):
    # Height of the body's top surface (top edge inboard to the centre) at x.
    top = section(z)[4:]
    for (x0, y0), (x1, y1) in zip(top, top[1:]):
        if x1 <= x <= x0: return lerp(y0, y1, (x0-x)/(x0-x1))
    return top[0][1]
def crisp(o, angle=20):
    # Smooth shading that keeps every crease sharper than `angle` degrees.
    bm = bmesh.new(); bm.from_mesh(o.data)
    for f in bm.faces: f.smooth = True
    for e in bm.edges: e.smooth = e.is_manifold and e.calc_face_angle(0) < math.radians(angle)
    bm.to_mesh(o.data); bm.free()
# Half-section segments, counted round the mirrored ring from the bottom centre.
BAND, INNER = {0, 1, 14, 15}, {6, 7, 8, 9}
def dark(k, z0, z1):
    # The black lower body, the dash under the windscreen and the bay under the
    # rear window are carbon; the rest is paint (the cockpit is white too).
    return k in BAND or (k in INNER and (z1 >= .70 and z0 <= .88 or z0 <= -.95 and z1 >= -1.78))
rings = [mirrored(z, half) for z, half in STATIONS]
n = len(rings[0]); faces, dark_faces = [], []
for j in range(len(rings)-1):
    for k in range(n):
        faces.append((j*n+k, j*n+(k+1)%n, (j+1)*n+(k+1)%n, (j+1)*n+k)); dark_faces.append(dark(k, STATIONS[j][0], STATIONS[j+1][0]))
faces += [tuple(range(n))[::-1], tuple((len(rings)-1)*n+k for k in range(n))]; dark_faces += [True, True]
data = bpy.data.meshes.new('Faceted monocoque'); data.from_pydata([p(v) for ring in rings for v in ring], [], faces); data.update()
shell = bpy.data.objects.new('Faceted monocoque', data); bpy.context.collection.objects.link(shell)
shell.parent = parent; data.materials.append(paint); data.materials.append(carbon)
bm = bmesh.new(); bm.from_mesh(data); bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
for f, black in zip(bm.faces, dark_faces): f.material_index = int(black)
bm.to_mesh(data); bm.free()
# True open arches with clean circular edges and black inner walls.
for z, wheel in ((FRONT_AXLE, FRONT), (REAR_AXLE, REAR)):
    for s in (-1, 1):
        cutter = cylinder('Arch cutter', (s*1.08, wheel['radius'], z), wheel['radius']+.027, .72, carbon, vertices=96, bevel=0)
        subtract(shell, cutter, 'Open arch')
        # A fine lip follows the cut on the side panel.
        r = wheel['radius']+.029
        tube('Arch edge', [side_at(z+math.cos(a)*r, wheel['radius']+math.sin(a)*r, s, .001) for a in [-.3+(math.pi+.6)*i/40 for i in range(41)]], .006, paint)
        # Shadowed well behind the tyre, recessed from the outer skin and kept
        # under the low bonnet.
        pts=[(s*.745, min(wheel['radius']+math.sin(a)*(wheel['radius']+.035), top_at(z+math.cos(a)*(wheel['radius']+.035), .745)-.03), z+math.cos(a)*(wheel['radius']+.035)) for a in [i*math.pi/32 for i in range(33)]]
        tube('Inner arch liner', pts, .014, carbon)
crisp(shell)
mod = shell.modifiers.new('Weighted surface normals', 'WEIGHTED_NORMAL'); mod.keep_sharp = True; mod.weight = 50

# ---- Gold glass: one sheet from a steeply raked windscreen over a long, almost
# flat roof, narrowing behind the doors into the dark rear window that runs down
# the deck. It is see-through: the white cockpit shows beneath it.
# z, glazing base, top of the side glass, roof edge, roof centre height
CANOPY = [
    (.88, (.93,.776), (.90,.772), (.70,.757), .762),
    (.55, (.95,.782), (.91,.90), (.72,.935), .945),
    (.25, (.95,.785), (.88,1.03), (.74,1.08), 1.09),
    (-.30, (.95,.79), (.87,1.04), (.73,1.09), 1.10),
    (-.90, (.94,.80), (.80,1.03), (.62,1.075), 1.085),
    (-1.20, (.72,.93), (.62,1.0), (.48,1.035), 1.045),
    (-1.45, (.42,.95), (.40,.96), (.36,.965), .97),
    (-1.78, (.29,.815), (.285,.817), (.25,.82), .823),
]
def glazing(z):
    # Half section of the glass at z: base, side glass top, roof edge, centre.
    z = min(CANOPY[0][0], max(CANOPY[-1][0], z))
    for a, b in zip(CANOPY, CANOPY[1:]):
        if b[0] <= z <= a[0]:
            t = (a[0]-z)/(a[0]-b[0])
            return [(lerp(u[0], v[0], t), lerp(u[1], v[1], t)) for u, v in zip(a[1:4], b[1:4])]+[(0, lerp(a[4], b[4], t))]
canopy_rings = [[(x, y, z) for x, y in glazing(z)]+[(-x, y, z) for x, y in glazing(z)[-2::-1]] for z, *_ in CANOPY]
n = len(canopy_rings[0])
canopy = mesh('Gold glass canopy', [v for ring in canopy_rings for v in ring],
    [(j*n+k, j*n+k+1, (j+1)*n+k+1, (j+1)*n+k) for j in range(len(canopy_rings)-1) for k in range(n-1)], glass, 0, True)
crisp(canopy)
for s in (-1, 1):
    side = lambda z, i, lift=.004: (s*glazing(z)[i][0], glazing(z)[i][1]+lift, z)
    tube('Glass lower seal', [side(z, 0, .002) for z in [.88-2.66*i/24 for i in range(25)]], .005, carbon)
    # Titanium windscreen edges, black frames round the door and quarter glass.
    tube('A pillar', [side(z, 1) for z in (.88, .55, .25)], .006, titanium)
    tube('Side glass frame', [side(z, 1) for z in (.25, -.30, -.90, -1.20, -1.45)], .005, carbon)
    tube('B pillar seal', [(s*(lerp(glazing(-.62)[0][0], glazing(-.62)[1][0], q)+.004), lerp(glazing(-.62)[0][1], glazing(-.62)[1][1], q), -.62) for q in (0, .5, 1)], .006, carbon)

# ---- Cockpit, seen through the glass: white seats either side of a console,
# a steer-by-wire yoke and a centre screen ahead of the left seat.
for s in (-1, 1):
    box('Seat cushion', (s*.37, .37, -.30), (.44, .09, .50), paint, .03)
    box('Seat back', (s*.37, .64, -.60), (.44, .52, .09), paint, .03, (-.38, 0, 0))
    box('Seat bolster', (s*.37, .64, -.585), (.46, .40, .05), carbon, .02, (-.38, 0, 0))
    box('Headrest', (s*.37, .93, -.70), (.22, .10, .07), paint, .025, (-.38, 0, 0))
box('Centre console', (0, .38, -.12), (.16, .14, .95), carbon, .02)
box('Dash screen', (0, .60, .78), (.30, .19, .015), throat, .006, (.45, 0, 0))
box('Yoke', (.37, .63, .29), (.30, .11, .03), graphite, .015, (.4, 0, 0))
box('Yoke column', (.37, .61, .52), (.04, .04, .45), graphite, .01)

# ---- Front: the bonnet ends in a sharp edge lit along its whole width, over a
# black band and splitter; slim hidden lamps sit at the fender blades' inner
# corners. The bonnet itself is the flat panel between the blades.
box('Bonnet light blade', (0, .479, 2.243), (1.22, .010, .012), head, .003)
box('Front band seam', (0, .33, 2.243), (1.30, .006, .006), titanium, .002)
mesh('Splitter lip',[(-.89,.15,2.08),(-.72,.12,2.26),(.72,.12,2.26),(.89,.15,2.08),(.84,.11,2.08),(.66,.095,2.25),(-.66,.095,2.25),(-.84,.11,2.08)],
     [(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3)],carbon,.006)
for s in (-1, 1):
    # Lamp slits on the blades' inner faces, just behind the lit bonnet edge.
    tilt = s*math.atan2(.07, .17)
    box('Hidden headlamp', (s*.685, .525, 2.215), (.13, .010, .024), head, .002, (0, 0, tilt))
    # Door cuts, the amber marker behind the front wheel and a flush release.
    tube('Door perimeter', [side_at(z, y, s, .003) for z, y in ((.86, .77), (.83, .55), (.80, .31))], .0035, carbon)
    tube('Door perimeter', [side_at(z, y, s, .003) for z, y in ((-.72, .80), (-.65, .55), (-.58, .33))], .0035, carbon)
    box('Side marker recess', side_at(.985, .60, s, .002), (.008, .022, .16), carbon, .004)
    box('Side marker', side_at(.985, .60, s, .006), (.006, .008, .10), caliper, .002)
    box('Flush door release', side_at(-.40, .72, s, .003), (.009, .021, .11), titanium, .003)
    cylinder('Yaw recess', (s*.99, .44, .92), .066, .012, carbon, (1, 0, 0), 32, .004)

# ---- Rear: the deck ends in a sharp edge over a full-width taillight in a black
# band that wraps the corners; a white panel carries a blank plate recess; the
# black diffuser box holds four titanium nozzles over four suction fans.
box('Taillight band', (0, .632, -2.168), (1.84, .05, .03), carbon, .008)
box('Continuous taillight', (0, .634, -2.185), (1.80, .014, .010), brake, .003)
for s in (-1, 1):
    box('Taillight wrap', side_at(-2.11, .634, s, .006), (.008, .014, .10), brake, .002)
    box('Reversing lens', (s*.70, .50, -2.178), (.10, .018, .008), lens, .003)
mesh('Rear panel', [(-.90,.605,-2.172),(.90,.605,-2.172),(.86,.47,-2.172),(-.86,.47,-2.172)], [(0,1,2,3)], paint, .004)
box('Plate recess', (0, .537, -2.176), (.34, .11, .01), carbon, .004)
box('Plate blank', (0, .537, -2.182), (.30, .085, .006), titanium, .003)
box('Diffuser box', (0, .295, -2.193), (1.72, .35, .05), carbon, .03)
mesh('Diffuser ramp',[(-.86,.13,-1.63),(.86,.13,-1.63),(.90,.30,-2.19),(-.90,.30,-2.19)],[(0,1,2,3)],carbon,.005)
for x in (-.88, .88):
    mesh('Diffuser fin',[(x-.009,.14,-1.80),(x-.009,.07,-2.23),(x-.009,.30,-2.22),(x+.009,.14,-1.80),(x+.009,.07,-2.23),(x+.009,.30,-2.22)],
         [(0,1,2),(3,5,4),(0,3,4,1),(1,4,5,2)],carbon,.003)
for x in (-.4, 0, .4):
    box('Fan divider', (x, .23, -2.226), (.014, .20, .03), carbon, .003)
# Recessed suction fans under the nozzles: shrouds, hubs and radial blades.
for x in (-.6, -.2, .2, .6):
    cylinder('Fan cavity',(x,.225,-2.219),.085,.014,throat,(0,0,1),24,0)
    for k in range(5):
        a=k*math.tau/5
        beam('Fan blade',(x+math.cos(a)*.022,.225+math.sin(a)*.022,-2.229),(x+math.cos(a+.35)*.074,.225+math.sin(a+.35)*.074,-2.229),.010,graphite,4)
    cylinder('Fan centre',(x,.225,-2.233),.022,.012,titanium,(0,0,1),12,0)
    bpy.ops.mesh.primitive_torus_add(major_segments=20,minor_segments=4,major_radius=.086,minor_radius=.007,location=p((x,.225,-2.231)))
    o=bpy.context.object; o.rotation_euler=p((0,0,1)).to_track_quat('Z','Y').to_euler(); finish(o,'Fan shroud',graphite)

# ---- The active wing: wide, with tall endplates and a light along its trailing
# edge, hung from swan-neck mounts that reach over it to its hinge. The game
# tilts it on that hinge into an air brake.
WING_Y,WING_Z=.95,-1.98
for s in (-1,1):
    tube('Swan neck mount',[(s*.50,.72,-1.80),(s*.50,.92,-1.85),(s*.50,1.03,-1.91),(s*.50,1.045,-1.965),(s*.50,1.01,-1.99),(s*.50,.983,-1.985)],.017,carbon)
    box('Mount foot',(s*.50,.78,-1.81),(.05,.02,.10),carbon,.006)
wing=empty('Rear_Wing',(0,WING_Y,WING_Z),body)
parent=wing
# Coordinates local to the hinge: a cambered blade, endplates and its light.
wrings=[]
for x,chord,rise in [(-.94,.16,0),(-.6,.17,.004),(0,.17,.006),(.6,.17,.004),(.94,.16,0)]:
    wrings.append([(x,rise,-chord),(x,rise+.025,-chord*.4),(x,rise+.035,chord*.55),(x,rise+.014,chord),(x,rise-.006,chord*.5)])
loft('Active aero blade',wrings,carbon,.003)
for s in (-1,1):
    plate=[(.17,-.005),(-.21,-.04),(-.21,.12),(.10,.07)]
    mesh('Wing endplate',[(s*(.94+t),y,z) for t in (0,.014) for z,y in plate],[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],carbon,.003)
box('Air brake light',(0,.004,-.171),(1.80,.012,.008),brake,.002)
parent=body

# ---- Ten cold-gas thrusters retain the established names and plume axes:
# compact titanium nozzles in the diffuser, at the corners and on the flanks.
def thruster(name,mouth,direction,scale=1):
    d=Vector(direction).normalized(); bell=.13*scale; start=Vector(mouth)-d*bell
    tangent=d.cross(Vector((0,1,0)) if abs(d.y)<.9 else Vector((1,0,0))).normalized()
    bitangent=d.cross(tangent).normalized()
    profile=[(0,.030),(.25,.032),(.50,.042),(.75,.058),(1,.070),(1,.064),(.75,.052),(.50,.036),(.25,.026),(0,.024)]
    verts=[];n=32
    for t,r in profile:
        for i in range(n):
            a=i*math.tau/n
            verts.append(tuple(start+d*(t*bell)+(tangent*math.cos(a)+bitangent*math.sin(a))*(r*scale)))
    mesh(name+' curved bell',verts,[(j*n+i,j*n+(i+1)%n,((j+1)%len(profile))*n+(i+1)%n,((j+1)%len(profile))*n+i) for j in range(len(profile)) for i in range(n)],titanium,0,True)
    cylinder(name+' throat back',tuple(start+d*.005),.029*scale,.008,throat,tuple(d),32,0)
    cylinder(name+' mounting flange',tuple(start),.047*scale,.015,titanium,tuple(d),24,.002)
    e=empty('Exhaust_'+name.replace(' ','_'),tuple(mouth),body)
    e['thrust']=list(d); e['exitRadius']=.07*scale
for i,x in enumerate((-.60,-.20,.20,.60)):
    thruster(f'Rear {i+1}',(x,.395,-2.25),(0,0,-1),.9)
for label,x,z in [('Lift FL',-.78,1.92),('Lift FR',.78,1.92),('Lift RL',-.80,-1.92),('Lift RR',.80,-1.92)]:
    box(label+' recessed socket',(x,.155,z),(.19,.055,.21),carbon,.014)
    thruster(label,(x,.085,z),(0,-1,0),.9)
for label,s in [('Yaw L',-1),('Yaw R',1)]: thruster(label,(s*1.005,.44,.92),(s,0,0),.75)

# ---- Six thin, straight black spokes, machined lips, brake discs and tread lines.
# Geometry stays within the original tyre envelope so physics still agrees.
def wheel(prefix,spec,outward):
    R,rim,w=spec['radius'],spec['rim'],spec['width']
    profile=[(-w/2+.014,rim+.005),(-w/2,rim+.025),(-w/2+.005,R-.025),(-w/2+.025,R-.004),(-w/2+.04,R),
             (-w*.22-.006,R),(-w*.22,R-.006),(-w*.22+.006,R),(-.006,R),(0,R-.006),(.006,R),(w*.22-.006,R),(w*.22,R-.006),(w*.22+.006,R),(w/2-.04,R),(w/2-.025,R-.004),(w/2-.005,R-.025),(w/2,rim+.025),(w/2-.014,rim+.005)]
    verts=[]; n=64
    for x,r in profile:
        for i in range(n):
            a=i*math.tau/n; verts.append((x,math.cos(a)*r,math.sin(a)*r))
    faces=[(j*n+i,j*n+(i+1)%n,((j+1)%len(profile))*n+(i+1)%n,((j+1)%len(profile))*n+i) for j in range(len(profile)) for i in range(n)]
    mesh(prefix+' performance tyre',verts,faces,rubber,0,True)
    def ring(name,x,r,t,material,segments=64):
        bpy.ops.mesh.primitive_torus_add(major_segments=segments,minor_segments=6,major_radius=r,minor_radius=t,location=p((x,0,0)))
        o=bpy.context.object; o.rotation_euler=p((1,0,0)).to_track_quat('Z','Y').to_euler();finish(o,prefix+' '+name,material)
    ring('sidewall bead',outward*w*.499,R-.039,.003,rubber,80)
    cylinder(prefix+' rim barrel',(0,0,0),rim,w*.89,graphite,vertices=64,bevel=0,caps=False)
    ring('machined rim',outward*w*.45,rim-.007,.009,titanium)
    ring('inner rim',outward*w*.46,rim-.027,.005,graphite)
    # A plain disc: drillings vanish behind the spokes once the wheels turn.
    cylinder(prefix+' brake rotor',(outward*w*.11,0,0),rim*.80,.016,titanium,vertices=48,bevel=0)
    cylinder(prefix+' brake hat',(outward*w*.14,0,0),rim*.34,.020,graphite,vertices=48,bevel=.002)
    for k in range(8):
        a=k*math.tau/8
        cylinder(prefix+' rotor bolt',(outward*w*.185,math.cos(a)*rim*.29,math.sin(a)*rim*.29),.007,.008,titanium,vertices=8,bevel=0)
    for k in range(6):
        a=k*math.tau/6
        def spokev(r,angle,depth):return (outward*depth,math.cos(a+angle)*r,math.sin(a+angle)*r)
        v=[spokev(.045,-.19,w*.47),spokev(rim-.014,-.075,w*.41),spokev(rim-.014,.075,w*.41),spokev(.045,.19,w*.47),
           spokev(.045,-.19,w*.37),spokev(rim-.014,-.075,w*.32),spokev(rim-.014,.075,w*.32),spokev(.045,.19,w*.37)]
        mesh(prefix+' forged spoke',v,[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],graphite,.003,True)
        # Fine titanium edge on the dark spoke provides readable wheel rotation.
        beam(prefix+' spoke edge',spokev(.07,-.08,w*.477),spokev(rim-.03,-.04,w*.43),.003,titanium,4)
        beam(prefix+' spoke relief',spokev(.085,0,w*.48),spokev(rim-.045,0,w*.435),.006,carbon,8)
    for k in range(5):
        a=k*math.tau/5
        cylinder(prefix+' wheel bolt',(outward*w*.50,math.cos(a)*.031,math.sin(a)*.031),.005,.007,titanium,vertices=8,bevel=0)
    cylinder(prefix+' centre lock',(outward*w*.48,0,0),.042,.024,graphite,vertices=20,bevel=.003)
    cylinder(prefix+' centre pin',(outward*w*.515,0,0),.018,.008,titanium,vertices=12,bevel=0)

for side,label in [(-1,'L'),(1,'R')]:
    for z,end,spec in [(FRONT_AXLE,'F',FRONT),(REAR_AXLE,'R',REAR)]:
        pivot=empty('Wheel_'+end+label,(side*spec['x'],spec['radius'],z),root)
        spinner=empty('Spinner_'+end+label,parent=pivot)
        parent=spinner; wheel(end+label,spec,side)
        parent=pivot
        box(end+label+' fixed caliper',(side*spec['width']*.20,.04,-spec['rim']*.62),(.045,.13,.072),caliper,.012)
parent=body

# ---- Editable source and studio. The studio is excluded from the game export.
scene=bpy.context.scene; scene.unit_settings.system='METRIC'
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.16,.19,.24,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.35
scene.render.engine='CYCLES';scene.cycles.samples=64;scene.cycles.use_denoising=True
scene.render.resolution_x=1600;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';bpy.context.preferences.filepaths.save_version=0
source_parts=len([o for o in root.children_recursive if o.type in {'MESH','CURVE','FONT'}])
parent=None
box('Studio floor',(0,-.055,0),(200,.1,200),mat('Studio',(.034,.044,.058),.12,.48),0)
def area(name,loc,power,size,target=(0,.5,0),color=(1,1,1)):
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;d.color=color
    o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=p(loc)
    o.rotation_euler=(p(target)-o.location).to_track_quat('-Z','Y').to_euler()
area('Key softbox',(-3,5,2),1500,5)
area('Cool rim',(4,3,-3),1700,4,color=(.76,.85,1))
area('Front strip',(1,4,5),1100,3)
area('Rear fill',(-3,2,-5),800,3,color=(1,.87,.72))
camdata=bpy.data.cameras.new('Hero camera');cam=bpy.data.objects.new('Hero camera',camdata);scene.collection.objects.link(cam)
cam.location=p((-6.2,2.8,-6.6));cam.rotation_euler=(p((0,.48,-.05))-cam.location).to_track_quat('-Z','Y').to_euler()
camdata.type='ORTHO';camdata.ortho_scale=5.7;scene.camera=cam
bpy.ops.object.select_all(action='DESELECT');root.select_set(True);bpy.context.view_layer.objects.active=root
for screen in bpy.data.screens:
    for area_ui in screen.areas:
        if area_ui.type=='VIEW_3D':
            area_ui.spaces.active.region_3d.view_distance=6
            area_ui.spaces.active.region_3d.view_location=p((0,.6,0))
            area_ui.spaces.active.shading.type='MATERIAL'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'roadster-rocket.blend'))
scene.render.filepath=str(OUT/'roadster-preview.png');bpy.ops.render.render(write_still=True)
# Front preview is kept with the assets so both ends can be inspected.
cam.location=p((-6.2,2.55,6.6));cam.rotation_euler=(p((0,.48,.1))-cam.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(OUT/'roadster-front-preview.png');bpy.ops.render.render(write_still=True)
import sys
sys.path.insert(0,str(ROOT/'scripts'))
from export_roadster import export_roadster
export_roadster(root,OUT,source_parts)
