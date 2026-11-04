"""Build an editable TRON: Legacy-inspired light cycle and a staged GLB.

Blender --background --factory-startup --python scripts/build-light-cycle.py
Pass -- --draft for a quick render pass. Outputs go to output/light-cycle.
Pass -- --bare to build the original bike without its rider.
Model coordinates follow Atlas: X right, Y up, Z forward.
"""
import math
import sys
from collections import defaultdict
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

OUT = Path(__file__).resolve().parents[1] / 'output' / 'light-cycle'
OPTIONS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
DRAFT = '--draft' in OPTIONS
RIDING = '--bare' not in OPTIONS
STEM = 'light-cycle-rider' if RIDING else 'light-cycle'
TAU = math.tau


def point(v):
    return Vector((v[0], -v[2], v[1]))


def material(name, color, metal=0, rough=.4, coat=0, emission=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF').inputs
    bsdf['Base Color'].default_value = (*color, 1)
    bsdf['Metallic'].default_value = metal
    bsdf['Roughness'].default_value = rough
    bsdf['Coat Weight'].default_value = coat
    bsdf['Coat Roughness'].default_value = .19
    if emission:
        bsdf['Emission Color'].default_value = (*color, 1)
        bsdf['Emission Strength'].default_value = emission
    return mat


def empty(name, collection, parent=None, at=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    collection.objects.link(obj)
    obj.parent = parent
    obj.location = point(at)
    obj.empty_display_size = .15
    return obj


def mesh(name, vertices, faces, mat, parent, *, smooth=False, bevel=0):
    data = bpy.data.meshes.new(name)
    data.from_pydata([point(v) for v in vertices], [], faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    parent.users_collection[0].objects.link(obj)
    obj.parent = parent
    data.materials.append(mat)
    for face in data.polygons:
        face.use_smooth = smooth
    if bevel:
        edge = obj.modifiers.new('Edge radius', 'BEVEL')
        edge.width = bevel
        edge.segments = 2
        edge.limit_method = 'ANGLE'
        obj.modifiers.new('Panel normals', 'WEIGHTED_NORMAL').keep_sharp = True
    return obj


def sweep(name, rings, mat, parent, *, closed=False, bevel=0):
    width = len(rings[0])
    last = len(rings) - 1
    faces = []
    for i in range(len(rings) if closed else last):
        a = i * width
        b = ((i + 1) % len(rings)) * width
        for j in range(width):
            k = (j + 1) % width
            faces.append((a + j, a + k, b + k, b + j))
    if not closed:
        faces.extend((tuple(reversed(range(width))), tuple(range(last * width, (last + 1) * width))))
    return mesh(name, [v for ring in rings for v in ring], faces, mat, parent, smooth=True, bevel=bevel)


def interpolate(stations, steps=5):
    values = [Vector(s) for s in stations]
    result = []
    for i, b in enumerate(values[:-1]):
        a = values[max(i - 1, 0)]
        c = values[i + 1]
        d = values[min(i + 2, len(values) - 1)]
        for step in range(steps):
            t = step / steps
            result.append(.5 * ((2*b) + (c-a)*t + (2*a-5*b+4*c-d)*t*t + (-a+3*b-3*c+d)*t*t*t))
    return [*result, values[-1]]


def fairing(name, stations, mat, parent):
    # Each station gives longitudinal position, lower and upper skin, and half-width.
    # This shared section puts the widest point just below the shoulder.
    outline = [
        (0, 0), (.62, .035), (.87, .13), (.985, .31), (1, .56), (.94, .77),
        (.72, .925), (.38, .988), (0, 1), (-.38, .988), (-.72, .925),
        (-.94, .77), (-1, .56), (-.985, .31), (-.87, .13), (-.62, .035),
    ]
    rings = [
        [(x * width, low + y * (high - low), z) for x, y in outline]
        for z, low, high, width in interpolate(stations, 4)
    ]
    return sweep(name, rings, mat, parent)


def panel(name, profile, side, thickness, mat, parent, bevel=.012):
    # Each point is (outboard distance, height, longitudinal position).
    return sweep(name, [
        [(side * (x - thickness), y, z) for x, y, z in profile],
        [(side * x, y, z) for x, y, z in profile],
    ], mat, parent, bevel=bevel)


def pipe(name, stations, radius, mat, parent, steps=5):
    path = interpolate(stations, steps)
    rings = []
    for i, center in enumerate(path):
        tangent = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        up = Vector((1, 0, 0)) if abs(tangent.x) < .9 else Vector((0, 1, 0))
        a = tangent.cross(up).normalized() * radius
        b = tangent.cross(a)
        rings.append([center + a * math.cos(TAU*k/8) + b * math.sin(TAU*k/8) for k in range(8)])
    return sweep(name, rings, mat, parent)


def revolve(name, profile, mat, parent, start=0, end=360, segments=80):
    # Profile points give lateral position and radius in the local wheel frame.
    closed = end - start == 360
    rings = []
    for i in range(segments if closed else segments + 1):
        angle = math.radians(start + (end - start) * i / segments)
        rings.append([(x, r * math.cos(angle), r * math.sin(angle)) for x, r in profile])
    return sweep(name, rings, mat, parent, closed=closed)


def side_ring(name, side, width, center, height, depth, mat, parent, start=0, end=360, segments=80):
    profile = [
        (width - depth, center - height * .5),
        (width - depth, center + height * .5),
        (width, center + height * .42),
        (width, center - height * .42),
    ]
    return revolve(name, [(side*x, r) for x, r in profile], mat, parent, start, end, segments)


def make_wheel(label, pivot, radius, half_width, mats):
    spinner = empty('Spinner_' + label, pivot.users_collection[0], pivot)
    w = half_width
    r = radius
    tyre_profile = [
        (-w*.76, r-.087), (-w*.99, r-.069), (-w, r-.043), (-w*.94, r-.023),
        (-w*.74, r-.008), (-w*.43, r), (w*.43, r), (w*.74, r-.008),
        (w*.94, r-.023), (w, r-.043), (w*.99, r-.069), (w*.76, r-.087),
    ]
    revolve(label + ' radial tyre', tyre_profile, mats['tyre'], spinner)

    # Exactly two uninterrupted neon channels circle each tire crown.
    for side in (-1, 1):
        x = side * w * .30
        revolve(label + ' neon crown groove ' + str(side),
                [(x-.009, r+.0015), (x+.009, r+.0015), (x+.009, r-.003), (x-.009, r-.003)],
                mats['cyan'], spinner)

    revolve(label + ' annular rotor', [
        (-w-.008, r-.098), (-w-.005, r-.072), (w+.005, r-.072), (w+.008, r-.098),
        (w-.008, r-.135), (w-.028, r-.151), (-w+.028, r-.151), (-w+.008, r-.135),
    ], mats['metal'], spinner)
    revolve(label + ' open stator', [
        (-w-.018, r-.138), (w+.018, r-.138), (w+.022, r-.160), (w-.006, r-.183),
        (-w+.006, r-.183), (-w-.022, r-.160),
    ], mats['frame'], pivot)
    for side, letter in [(-1, 'L'), (1, 'R')]:
        prefix = label + ' ' + letter
        side_ring(prefix + ' light channel', side, w+.014, r-.104, .045, .018, mats['recess'], spinner)
        side_ring(prefix + ' luminous rim', side, w+.016, r-.104, .025, .009, mats['cyan'], spinner)
        side_ring(prefix + ' inner bearing lip', side, w+.024, r-.158, .010, .007, mats['metal'], pivot)
        for k in range(8):
            start = 45*k + 11
            side_ring(prefix + ' bearing index ' + str(k+1), side, w+.026, r-.174,
                      .010, .005, mats['dim'], pivot, start, start+12, 4)
    return spinner


def build_cycle(collection):
    mats = {
        'shell': material('Obsidian ceramic', (.009, .013, .021), .48, .23, .48),
        'armor': material('Blue graphite', (.025, .035, .049), .56, .30, .24),
        'frame': material('Black anodized chassis', (.012, .018, .026), .48, .38),
        'metal': material('Machined titanium', (.14, .187, .228), .79, .29),
        'recess': material('Light guide gasket', (.008, .012, .017), .28, .41),
        'tyre': material('Slick rubber', (.019, .024, .033), 0, .64),
        'groove': material('Tread recess', (.006, .008, .011), 0, .87),
        'seat': material('Saddle elastomer', (.024, .031, .044), 0, .61),
        'glass': material('Smoked dash glass', (.024, .074, .092), .46, .16, .42),
        'cyan': material('Ion blue light guide', (.004, .36, 1), .08, .23, emission=4.5),
        'dim': material('Blue bearing indices', (.034, .33, .60), .35, .34, emission=.65),
        'head': material('Ice white headlamp', (.40, .84, 1), .1, .19, emission=5.5),
        'brake': material('Brake lamp', (1, .030, .046), .1, .23, emission=2.6),
        'ink': material('Titanium markings', (.24, .48, .58), .28, .54),
    }
    root = empty('Light_Cycle', collection)
    root['asset'] = 'Light Cycle / TRON: Legacy-inspired'
    root['reference'] = 'https://danielsimon.com/film-design/tron-legacy/'
    root['forward'] = '+Z in glTF'
    root['wheelbase'] = 2.19
    root['frontWheelRadius'] = .594
    root['rearWheelRadius'] = .614
    body = empty('Body', collection, root)
    front = empty('Wheel_Front', collection, root, (0, .596, 1.09))
    rear = empty('Wheel_Rear', collection, root, (0, .616, -1.10))
    front_spin = make_wheel('Front', front, .594, .156, mats)
    rear_spin = make_wheel('Rear', rear, .614, .201, mats)

    fairing('Lower monocoque', [
        (-.58, .74, .86, .11), (-.46, .53, .98, .20), (-.33, .32, 1.02, .241),
        (-.08, .235, 1.03, .261), (.21, .26, 1.065, .278), (.38, .34, 1.09, .28),
        (.51, .51, 1.10, .243), (.60, .72, 1.10, .185), (.70, .94, 1.07, .12),
    ], mats['frame'], body)
    fairing('Ventral skid', [
        (-.48, .43, .52, .075), (-.28, .262, .36, .173), (-.11, .214, .30, .204),
        (.17, .241, .32, .209), (.31, .304, .39, .187), (.43, .415, .48, .089),
    ], mats['metal'], body)
    fairing('Upper fairing', [
        (-1.38, 1.149, 1.162, .061), (-1.30, 1.173, 1.225, .139), (-1.12, 1.193, 1.275, .193),
        (-.91, 1.178, 1.305, .207), (-.70, 1.10, 1.27, .200), (-.48, .938, 1.142, .193),
        (-.22, .857, 1.088, .228), (.04, .845, 1.109, .267), (.29, .881, 1.224, .296),
        (.51, .951, 1.332, .306), (.73, 1.098, 1.347, .281), (.91, 1.176, 1.339, .227),
        (1.09, 1.197, 1.319, .209), (1.28, 1.165, 1.278, .198),
        (1.46, 1.075, 1.203, .167), (1.57, 1.019, 1.121, .11), (1.60, 1.026, 1.063, .069),
    ], mats['shell'], body)
    fairing('Recessed saddle', [
        (-.97, 1.281, 1.31, .059), (-.84, 1.267, 1.309, .111), (-.63, 1.181, 1.235, .147),
        (-.41, 1.102, 1.151, .153), (-.21, 1.075, 1.118, .147), (.03, 1.095, 1.127, .131),
        (.16, 1.138, 1.159, .081),
    ], mats['seat'], body)
    fairing('Smoked instrument shroud', [
        (.36, 1.229, 1.255, .045), (.44, 1.271, 1.314, .082), (.58, 1.318, 1.367, .115),
        (.74, 1.335, 1.377, .117), (.86, 1.33, 1.363, .089), (.94, 1.321, 1.344, .043),
    ], mats['glass'], body)
    fairing('Steering neck cover', [
        (.67, .963, 1.18, .149), (.82, .992, 1.244, .192), (1.01, 1.068, 1.248, .207),
        (1.21, 1.100, 1.215, .191), (1.40, 1.072, 1.161, .146),
    ], mats['frame'], body)

    # The outer fender skins sit over the tyres with air between them and the rubber.
    for label, pivot, r, width, start, end in [
        ('Front', front, .594, .156, -48, 66),
        ('Rear', rear, .614, .201, -69, 55),
    ]:
        revolve(label + ' floating fender', [
            (-width-.035, r+.045), (-width-.029, r+.068), (-width*.59, r+.083),
            (width*.59, r+.083), (width+.029, r+.068), (width+.035, r+.045),
            (width+.018, r+.031), (-width-.018, r+.031),
        ], mats['shell'], pivot, start, end, 32)

    for side, letter in [(-1, 'L'), (1, 'R')]:
        def mirror(stations):
            return [(side*x, y, z) for x, y, z in stations]

        blade = panel('Front ' + letter + ' cantilever', [
            (.258, .809, .432), (.267, .980, .566), (.253, 1.120, .761),
            (.226, 1.144, .913), (.218, 1.108, 1.005), (.212, 1.014, 1.038),
            (.215, 1.003, .976), (.231, 1.018, .871), (.247, .960, .745), (.255, .807, .624),
        ], side, .050, mats['armor'], front, bevel=.019)
        # Cantilever points are in bike space and the front blade steers about the axle.
        blade.location = -front.location

        panel('Rear ' + letter + ' torque arm', [
            (.248, .442, -.204), (.242, .608, -.366), (.255, .751, -.538), (.266, .872, -.777),
            (.262, .886, -.869), (.255, .830, -.903), (.258, .772, -.835),
            (.257, .727, -.685), (.254, .601, -.529), (.251, .458, -.345),
        ], side, .058, mats['armor'], body, bevel=.017)
        for label, parent, x, y, z, radius in [
            ('Front', front, .220, .444, -.094, .035),
            ('Rear', body, .267, .843, -.817, .033),
        ]:
            section = [(side*(x-.012), .012), (side*(x-.012), radius),
                       (side*(x+.002), radius), (side*(x+.006), radius-.006),
                       (side*(x+.006), .012)]
            cap = revolve(label + ' ' + letter + ' bearing fastener', section, mats['metal'],
                          parent, segments=12)
            cap.location = point((0, y, z))
        panel('Drive pack ' + letter, [
            (.227, .441, -.371), (.263, .755, -.36), (.269, .869, -.212), (.294, .858, .202),
            (.294, .774, .414), (.280, .575, .414), (.267, .453, .195), (.246, .399, -.177),
        ], side, .026, mats['armor'], body)
        panel('Radiator recess ' + letter, [
            (.272, .473, -.166), (.287, .629, -.205), (.304, .666, .162),
            (.304, .625, .285), (.288, .526, .218), (.278, .47, .069),
        ], side, .010, mats['recess'], body, bevel=.008)
        for k in range(6):
            z = -.146 + k*.061
            x = .281 + k*.0025
            pipe('Cooling vane ' + letter + str(k+1), mirror([(x, .49+k*.007, z+.047),
                 (x+.005, .555+k*.006, z+.019), (x+.007, .613+k*.005, z)]),
                 .008, mats['metal'], body, steps=2)

        shoulder = [
            (.152, 1.188, -1.325), (.198, 1.234, -1.135), (.212, 1.258, -.947),
            (.21, 1.219, -.764), (.197, 1.134, -.576), (.206, 1.038, -.395),
            (.242, 1.003, -.208), (.269, 1.011, -.009), (.287, 1.061, .179),
            (.302, 1.145, .334), (.312, 1.239, .506), (.296, 1.276, .675),
            (.257, 1.276, .833), (.223, 1.271, 1.024), (.212, 1.242, 1.216),
            (.19, 1.17, 1.402), (.14, 1.091, 1.551),
        ]
        pipe('Recessed shoulder channel ' + letter, mirror(shoulder), .021, mats['recess'], body)
        lens_path = interpolate(mirror([(x+.025, y, z) for x, y, z in shoulder]), 5)
        lens_rings = []
        for i, center in enumerate(lens_path):
            tangent = (lens_path[min(i+1, len(lens_path)-1)]-lens_path[max(0, i-1)]).normalized()
            normal = Vector((side, 0, 0))
            normal = (normal-tangent*normal.dot(tangent)).normalized()
            across = tangent.cross(normal).normalized() * .011
            inset = normal * .007
            lens_rings.append([center-across, center+across,
                               center+across-inset, center-across-inset])
        sweep('Shoulder light ' + letter, lens_rings, mats['cyan'], body)
        pipe('Ventral light ' + letter, mirror([
            (.242, .42, -.343), (.257, .359, -.213), (.274, .343, .013),
            (.288, .402, .272), (.289, .472, .366),
        ]), .0075, mats['dim'], body)
        pipe('Footrest ' + letter, mirror([
            (.222, .557, -.505), (.282, .556, -.53), (.335, .555, -.517),
        ]), .027, mats['frame'], body, steps=3)
        pipe('Grip mount ' + letter, mirror([
            (.087, 1.264, .735), (.225, 1.268, .72), (.30, 1.234, .684), (.344, 1.228, .618),
        ]), .021, mats['metal'], body)
        pipe('Bar grip ' + letter, mirror([
            (.309, 1.231, .655), (.346, 1.229, .605), (.352, 1.228, .549),
        ]), .032, mats['seat'], body, steps=4)

        # Upright lettering on each side of the nearly vertical pack face.
        font = bpy.data.curves.new('LC-01 lettering ' + letter, 'FONT')
        font.body = 'LC  /  01'
        font.size = .059
        font.align_x = 'CENTER'
        obj = bpy.data.objects.new(font.name, font)
        collection.objects.link(obj)
        obj.parent = body
        obj.location = point((side*.298, .708, .075))
        axes = (point((0, 0, -side)), point((0, 1, 0)), point((side, 0, 0)))
        obj.rotation_euler = Matrix(axes).transposed().to_euler()
        font.materials.append(mats['ink'])

    pipe('Front projector slit', [
        (-.084, 1.064, 1.601), (-.043, 1.055, 1.618), (0, 1.053, 1.623),
        (.043, 1.055, 1.618), (.084, 1.064, 1.601),
    ], .0105, mats['head'], body)
    empty('Trail_Emitter', collection, body, (0, 1.23, -1.45))
    pipe('Rear stop light', [
        (-.129, 1.224, -1.388), (-.077, 1.246, -1.405), (0, 1.249, -1.409),
        (.077, 1.246, -1.405), (.129, 1.224, -1.388),
    ], .010, mats['brake'], body)
    pipe('Dash status bar', [
        (-.052, 1.354, .555), (-.032, 1.358, .559), (.032, 1.358, .559), (.052, 1.354, .555),
    ], .0037, mats['dim'], body, steps=3)

    return root, (body, front, front_spin, rear, rear_spin)


def suit_form(name, stations, mat, rider, *, side=1, sides=20, profile_power=1):
    """Loft a fitted suit section and expose its surface for trim and armor."""
    centers = interpolate([row[:3] for row in stations], 4)
    radii = interpolate([row[3:] for row in stations], 4)
    frames = []
    for i, center in enumerate(centers):
        tangent = (centers[min(i+1, len(centers)-1)] - centers[max(0, i-1)]).normalized()
        lateral = Vector((side, 0, 0))
        lateral = (lateral - tangent * lateral.dot(tangent)).normalized()
        frames.append((center, lateral, tangent.cross(lateral) * side))

    def ring_point(index, angle, offset):
        center, a, b = frames[index]
        ra, rb = radii[index]
        angle = math.radians(angle)
        x = math.copysign(abs(math.cos(angle))**profile_power, math.cos(angle))
        y = math.copysign(abs(math.sin(angle))**profile_power, math.sin(angle))
        return center + a*((ra+offset)*x) + b*((rb+offset)*y)

    def surface(t, angle, offset=0):
        step = max(0, min(t, 1)) * (len(frames)-1)
        i = int(step)
        return ring_point(i, angle, offset).lerp(
            ring_point(min(i+1, len(frames)-1), angle, offset), step-i)

    rings = [[ring_point(i, 360*k/sides, 0) for k in range(sides)] for i in range(len(frames))]
    sweep(name, rings, mat, rider)
    return surface


def suit_panel(name, surface, start, end, angle, width, mat, rider, height=.004):
    rings = []
    for i in range(10):
        t = i / 9
        half = width * (.44 + .56 * min(1, t/.18, (1-t)/.15))
        across = [angle + half*k/4 for k in range(-4, 5)]
        pos = start + (end-start)*t
        upper = [surface(pos, a, height * (.52 + .48 * math.sin(math.pi*k/8)))
                 for k, a in enumerate(across)]
        rings.append(upper + [surface(pos, a, -.006) for a in reversed(across)])
    return sweep(name, rings, mat, rider)


def suit_trace(name, surface, route, radius, mat, rider, offset=.006):
    # Flat electroluminescent ribbons follow the suit skin, including at bends.
    route = interpolate(route, 4)
    rings = []
    for i, (t, angle) in enumerate(route):
        center = surface(t, angle, offset)
        normal = (surface(t, angle, offset+.01) - center).normalized()
        previous = surface(*route[max(i-1, 0)], offset)
        following = surface(*route[min(i+1, len(route)-1)], offset)
        lateral = (following-previous).cross(normal).normalized() * radius
        inset = normal * .002
        rings.append([center-lateral, center+lateral,
                      center+lateral-inset, center-lateral-inset])
    return sweep(name, rings, mat, rider)


def rider_helmet(rider, shell, seal, glow):
    visor = material('Rider smoked visor', (.002, .007, .013), .46, .15, .55)
    rows = interpolate([
        (1.466, .064, .133, .370), (1.482, .092, .102, .416),
        (1.514, .114, .083, .462), (1.556, .125, .069, .485),
        (1.604, .130, .066, .478), (1.653, .128, .076, .452),
        (1.703, .115, .091, .417), (1.744, .090, .122, .368),
        (1.770, .050, .169, .312), (1.779, .003, .234, .247),
    ], 4)

    def across(row, angle, offset):
        y, half, aft, front = row
        a = math.radians(angle)
        return Vector(((half+offset)*math.sin(a), y,
                       (front+aft)*.5 + ((front-aft)*.5+offset)*math.cos(a)))

    def surface(height, angle, offset=0):
        for i, hi in enumerate(rows[1:]):
            if height <= hi.x:
                low = rows[i]
                row = low.lerp(hi, (height-low.x)/(hi.x-low.x))
                return across(row, angle, offset)
        return across(rows[-1], angle, offset)

    sweep('Aerodynamic helmet shell', [[across(row, k*360/40, 0) for k in range(40)]
                                      for row in rows], shell, rider)

    def glass(name, mat, max_angle, outer, margin):
        rings = []
        for k in range(33):
            a = max_angle*(k/16-1)
            edge = (abs(a) / max_angle)**2
            low = 1.537 + .049*edge - margin
            high = 1.683 - .032*edge + margin
            heights = [low + (high-low)*i/9 for i in range(10)]
            rings.append([surface(y, a, outer) for y in heights] +
                         [surface(y, a, -.003) for y in reversed(heights)])
        sweep(name, rings, mat, rider)

    glass('Visor gasket', seal, 104, .005, .006)
    glass('Wraparound visor', visor, 99, .009, 0)
    for side, label in [(-1, 'L'), (1, 'R')]:
        path = [(1.692, 66), (1.681, 87), (1.659, 106),
                (1.618, 125), (1.591, 145), (1.589, 164)]
        pipe('Helmet circuit ' + label,
             [surface(y, side*a, .0055) for y, a in interpolate(path, 4)],
             .003, glow, rider, steps=1)
        cheek = [(1.509, 48), (1.519, 68), (1.543, 88), (1.559, 99)]
        pipe('Helmet cheek blade ' + label,
             [surface(y, side*a, .007) for y, a in interpolate(cheek, 4)],
             .005, shell, rider, steps=1)
        for k in range(3):
            pipe('Helmet intake ' + label + str(k),
                 [surface(1.51+.006*k, side*a, .005) for a in range(56, 83, 3)],
                 .0018, seal, rider, steps=1)


def identity_disc(rider, torso, shell, seal, glow):
    collection = rider.users_collection[0]
    anchor = torso(.57, 90, .011)
    normal = (torso(.57, 90, .021)-anchor).normalized()
    disc = empty('Identity_Disc', collection, rider, anchor)
    disc.rotation_euler = point(normal).to_track_quat('X', 'Z').to_euler()
    disc.scale = (.85, .91, .91)
    revolve('Recessed disc dock', [
        (-.049, .006), (-.046, .112), (-.034, .132), (-.012, .132), (-.005, .104), (-.005, .006),
    ], seal, disc, segments=48)
    revolve('Identity disc housing', [
        (-.024, .069), (-.021, .133), (-.013, .145), (.002, .147), (.017, .132),
        (.019, .081), (.011, .068),
    ], shell, disc, segments=64)
    revolve('Identity disc outer blade', [
        (.003, .137), (.006, .147), (.012, .143), (.014, .137),
    ], glow, disc, segments=64)
    for k in range(3):
        side_ring('Identity disc inner arc ' + str(k+1), 1, .021, .087, .007, .004,
                  glow, disc, k*120+3, k*120+117, 18)
    return disc


def build_rider(body):
    rider = empty('Rider', body.users_collection[0], body)
    rider['pose'] = 'Fixed light cycle racing tuck'
    suit = material('Rider matte undersuit', (.010, .013, .018), 0, .73)
    suit_nodes = suit.node_tree.nodes
    suit_shader = suit_nodes.get('Principled BSDF')
    suit_shader.inputs['Specular IOR Level'].default_value = .24
    grain = suit_nodes.new('ShaderNodeTexNoise')
    grain.label = 'Fine weave'
    grain.inputs['Scale'].default_value = 155
    grain.inputs['Detail'].default_value = 2
    bump = suit_nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .24
    bump.inputs['Distance'].default_value = .0018
    suit.node_tree.links.new(grain.outputs['Fac'], bump.inputs['Height'])
    suit.node_tree.links.new(bump.outputs['Normal'], suit_shader.inputs['Normal'])
    armor = material('Rider molded graphite', (.013, .017, .024), .03, .53, .03)
    armor.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value = .27
    seal = material('Rider flexible seals', (.005, .008, .012), 0, .64)
    shell = material('Rider black helmet enamel', (.005, .009, .016), .26, .24, .40)
    glow = material('Rider blue circuitry', (.012, .46, 1), .04, .3, emission=3.8)
    torso = suit_form('Fitted torso and pelvis', [
        (0, 1.249, -.561, .092, .073), (0, 1.257, -.492, .157, .114),
        (0, 1.268, -.382, .160, .116), (0, 1.306, -.263, .153, .102),
        (0, 1.361, -.137, .178, .116), (0, 1.411, -.018, .207, .126),
        (0, 1.448, .070, .209, .110), (0, 1.477, .140, .151, .083),
        (0, 1.496, .183, .079, .059),
    ], suit, rider, sides=28, profile_power=.86)
    suit_panel('Spine reinforcement', torso, .22, .75, 90, 24, armor, rider)
    suit_panel('Chest plate', torso, .52, .85, 270, 60, armor, rider)
    suit_panel('Sacral reinforcement', torso, .08, .30, 90, 55, armor, rider, .003)
    suit_trace('Waist seam', torso, [(.19, 13), (.195, 48), (.20, 90), (.195, 132), (.19, 167)],
               .003, seal, rider, offset=.005)
    suit_form('Flexible neck cowl', [
        (0, 1.488, .114, .080, .062), (0, 1.514, .170, .086, .065),
        (0, 1.554, .216, .071, .060), (0, 1.580, .228, .059, .057),
    ], seal, rider)
    rider_helmet(rider, shell, seal, glow)
    disc = identity_disc(rider, torso, shell, seal, glow)

    for side, label in [(-1, 'L'), (1, 'R')]:
        def limb(name, rows, mat=suit, sides=20):
            return suit_form(name + ' ' + label, [(side*x, y, z, a, b) for x, y, z, a, b in rows],
                             mat, rider, side=side, sides=sides)

        def trace(name, surface, route, radius=.005, offset=.006):
            suit_trace(name + ' ' + label, surface, route, radius, glow, rider, offset=offset)

        def back_angle(route):
            return [(t, a if side == 1 else 180-a) for t, a in route]

        suit_panel('Scapular panel ' + label, torso, .41, .85,
                   47 if side == 1 else 133, 26, armor, rider)
        for k in range(4):
            suit_panel('Abdominal articulation ' + label + str(k), torso, .28+k*.047, .31+k*.047,
                       -16 if side == 1 else 196, 31, armor, rider, .003)
        trace('Shoulder yoke', torso, back_angle([
            (.879, 67), (.825, 53), (.732, 43), (.63, 38), (.526, 40), (.45, 52),
        ]), .006, .006)
        trace('Lower back circuit', torso, back_angle([
            (.407, 51), (.351, 42), (.248, 35), (.163, 26),
        ]), .005, .006)
        trace('Chest circuit', torso, back_angle([
            (.807, -23), (.737, -33), (.617, -45), (.52, -53),
        ]), .005, .006)

        arm = limb('Bent sleeve', [
            (.164, 1.450, .034, .079, .083), (.213, 1.435, .070, .085, .079),
            (.264, 1.393, .136, .073, .068), (.301, 1.328, .213, .057, .052),
            (.316, 1.289, .283, .047, .045), (.320, 1.287, .347, .057, .046),
            (.332, 1.278, .423, .053, .041), (.344, 1.265, .498, .038, .033),
            (.347, 1.260, .552, .034, .030),
        ])
        suit_panel('Shoulder armor ' + label, arm, .07, .29, 29, 65, armor, rider, .005)
        suit_panel('Bicep panel ' + label, arm, .30, .44, 13, 44, armor, rider)
        suit_panel('Elbow guard ' + label, arm, .44, .57, -8, 54, armor, rider)
        suit_panel('Gauntlet ' + label, arm, .65, .97, 23, 58, armor, rider)
        trace('Upper arm circuit', arm, [(.14, 47), (.24, 39), (.36, 24), (.44, 19)], .006, .006)
        trace('Forearm circuit', arm, [(.59, 13), (.68, 17), (.79, 31), (.91, 34)], .0055, .006)
        trace('Gauntlet return', arm, [(.73, 1), (.83, 5), (.91, 17)], .0037)
        for k in range(4):
            suit_panel('Elbow stretch rib ' + label + str(k), arm, .45+k*.026, .462+k*.026,
                       162, 51, armor, rider, .0025)

        glove = limb('Glove palm', [
            (.347, 1.260, .527, .029, .022), (.349, 1.260, .556, .042, .025),
            (.347, 1.263, .597, .041, .026), (.345, 1.255, .626, .030, .021),
            (.343, 1.247, .641, .017, .012),
        ], seal, 16)
        suit_panel('Glove knuckle shell ' + label, glove, .31, .85, 77, 55, armor, rider)
        for k in range(4):
            z = .550 + .023*k
            radius = .0135 - .0008*k
            finger = [(side*x, y, zz) for x, y, zz in [
                (.370, 1.260, z), (.386, 1.243, z+.004),
                (.386, 1.222, z+.005), (.369, 1.207, z+.006), (.348, 1.206, z+.007),
            ]]
            pipe('Grip finger ' + label + str(k+1), finger, radius, suit, rider, steps=3)
        pipe('Grip thumb ' + label, [(side*x, y, z) for x, y, z in [
            (.327, 1.260, .549), (.308, 1.244, .562), (.309, 1.221, .572),
            (.322, 1.206, .593), (.339, 1.207, .597),
        ]], .014, suit, rider, steps=3)

        leg = limb('Bent riding trouser', [
            (.103, 1.259, -.469, .112, .118), (.174, 1.220, -.369, .118, .111),
            (.244, 1.148, -.256, .101, .090), (.292, 1.061, -.135, .079, .072),
            (.314, .990, -.075, .066, .065), (.329, .936, -.128, .060, .057),
            (.336, .851, -.242, .071, .061), (.337, .740, -.374, .052, .047),
            (.338, .657, -.469, .043, .038), (.338, .627, -.496, .038, .034),
        ], sides=24)
        suit_panel('Hip panel ' + label, leg, .06, .27, 13, 51, armor, rider)
        suit_panel('Thigh inset ' + label, leg, .18, .38, 64, 22, seal, rider, .002)
        suit_panel('Knee slider ' + label, leg, .37, .53, 37, 64, armor, rider, .006)
        suit_panel('Shin armor ' + label, leg, .60, .91, 22, 55, armor, rider)
        suit_panel('Boot ankle cuff ' + label, leg, .83, .99, 20, 85, seal, rider, .004)
        trace('Thigh circuit', leg, [(.095, 21), (.221, 31), (.322, 35), (.367, 43)], .006, .006)
        trace('Knee circuit', leg, [(.40, 49), (.46, 38), (.53, 30)], .005, .008)
        trace('Shin circuit', leg, [(.62, 27), (.71, 21), (.81, 16), (.87, 19)], .0055, .006)
        for k in range(4):
            suit_panel('Knee stretch rib ' + label + str(k), leg, .46+k*.023, .471+k*.023,
                       -88, 48, armor, rider, .0025)

        boot = limb('Riding boot', [
            (.335, .609, -.599, .035, .031), (.337, .615, -.563, .051, .042),
            (.337, .618, -.512, .054, .050), (.341, .610, -.446, .057, .039),
            (.350, .602, -.372, .055, .029), (.356, .601, -.332, .043, .023),
            (.358, .600, -.314, .023, .014),
        ], armor)
        suit_panel('Boot outsole ' + label, boot, .05, .97, -90, 86, seal, rider, .009)
        suit_panel('Boot toe cap ' + label, boot, .57, .94, 90, 85, shell, rider, .003)
        for k in range(3):
            suit_panel('Boot instep flex ' + label + str(k), boot, .37+k*.048, .391+k*.048,
                       87, 67, seal, rider, .002)
        trace('Boot heel index', boot, [(.14, 9), (.24, 5), (.37, 4)], .004)

    return rider, disc


def aim(obj, at):
    obj.rotation_euler = (point(at) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def studio(scene, collection):
    def area(name, at, target, energy, color, size, length):
        data = bpy.data.lights.new(name, 'AREA')
        data.shape = 'RECTANGLE'
        data.energy = energy
        data.color = color
        data.size = size
        data.size_y = length
        obj = bpy.data.objects.new(name, data)
        collection.objects.link(obj)
        obj.location = point(at)
        aim(obj, target)

    def camera(name, at, target, width):
        data = bpy.data.cameras.new(name)
        data.type = 'PERSP'
        data.lens = (point(at)-point(target)).length * data.sensor_width / width
        obj = bpy.data.objects.new(name, data)
        collection.objects.link(obj)
        obj.location = point(at)
        aim(obj, target)
        return obj

    stage = empty('Stage', collection)
    mesh('Graphite studio floor', [(-200, 0, -200), (200, 0, -200), (200, 0, 200), (-200, 0, 200)],
         [(3, 2, 1, 0)], material('Studio floor', (.011, .017, .025), .48, .26), stage)
    area('Overhead strip', (-.8, 4.3, .4), (0, .8, 0), 190, (.85, .92, 1), .8, 4.5)
    area('Front softbox', (3.2, 3.1, 2.9), (0, .95, .1), 130, (.79, .89, 1), 1.6, 3.1)
    area('Blue edge strip', (-1.9, 2.7, -1.4), (0, .8, -.25), 270, (.10, .46, 1), .7, 4)
    area('Rear rim', (1.5, 2.6, -3.1), (0, 1.0, -.5), 165, (.74, .87, 1), .65, 2.5)
    area('Low front glint', (2.4, .8, 3.7), (0, .75, .7), 25, (.20, .58, 1), .6, 1.9)

    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get('Background')
    background.inputs['Color'].default_value = (.20, .29, .42, 1)
    background.inputs['Strength'].default_value = .075

    nodes = bpy.data.node_groups.new('Optical glow', 'CompositorNodeTree')
    scene.compositing_node_group = nodes
    nodes.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    render = nodes.nodes.new('CompositorNodeRLayers')
    glare = nodes.nodes.new('CompositorNodeGlare')
    glare.inputs['Type'].default_value = 'Fog Glow'
    glare.inputs['Threshold'].default_value = .9
    glare.inputs['Strength'].default_value = .75
    glare.inputs['Size'].default_value = .32
    glare.location.x = 240
    output = nodes.nodes.new('NodeGroupOutput')
    output.location.x = 490
    nodes.links.new(render.outputs['Image'], glare.inputs['Image'])
    nodes.links.new(glare.outputs['Image'], output.inputs['Image'])

    if RIDING:
        return {
            'hero': camera('Hero camera', (5.7, 2.55, 3.9), (0, .84, .02), 4.28),
            'rear': camera('Rear camera', (4.8, 3.1, -4.0), (0, .84, -.05), 4.20),
        }
    return {
        'hero': camera('Hero camera', (5.75, 2.13, 3.65), (0, .65, .02), 4.13),
        'rear': camera('Rear camera', (4.9, 2.38, -3.46), (0, .63, -.05), 4.05),
    }


def export_cycle(root, groups):
    # Keep the .blend editable, then batch the staged copy by parent and material.
    # Bearings and fenders keep their own motion relative to each wheel spinner.
    bpy.ops.object.select_all(action='DESELECT')
    for group in groups:
        buckets = defaultdict(list)
        for obj in list(group.children):
            if obj.type not in {'MESH', 'FONT'}:
                continue
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            if obj.type == 'FONT':
                bpy.ops.object.convert(target='MESH')
                obj = bpy.context.object
            for modifier in list(obj.modifiers):
                bpy.ops.object.modifier_apply(modifier=modifier.name)
            obj.select_set(False)
            buckets[obj.data.materials[0].name].append(obj)
        for name, parts in buckets.items():
            for obj in parts:
                obj.select_set(True)
            bpy.context.view_layer.objects.active = parts[0]
            if len(parts) > 1:
                bpy.ops.object.join()
            batch = bpy.context.object
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            batch.name = group.name + '__' + name
            batch.select_set(False)

    root.select_set(True)
    for obj in root.children_recursive:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=str(OUT / (STEM + '.glb')), export_format='GLB',
                             use_selection=True, export_yup=True, export_extras=True,
                             export_cameras=False, export_lights=False, export_animations=False)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.name = 'Light Cycle Studio'
    scene.unit_settings.system = 'METRIC'
    model = bpy.data.collections.new('01 Light Cycle')
    stage = bpy.data.collections.new('02 Studio')
    scene.collection.children.link(model)
    scene.collection.children.link(stage)
    root, groups = build_cycle(model)
    if RIDING:
        groups += build_rider(groups[0])
    cameras = studio(scene, stage)
    scene.camera = cameras['hero']
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1125
    scene.render.resolution_percentage = 52 if DRAFT else 100
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'AgX'
    scene.render.filepath = '//' + STEM + '-hero.png'
    if DRAFT:
        scene.cycles.samples = 12
    bpy.context.preferences.filepaths.save_version = 0
    for obj in stage.objects:
        obj.hide_set(True)
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                view = area.spaces.active
                view.region_3d.view_distance = 4.4
                view.region_3d.view_location = point((0, .88 if RIDING else .65, 0))
                view.region_3d.view_rotation = cameras['hero'].rotation_euler.to_quaternion()
                view.region_3d.view_perspective = 'ORTHO'
                view.shading.color_type = 'MATERIAL'
                view.shading.studiolight_rotate_z = .5
                view.overlay.show_overlays = False

    if not DRAFT:
        bpy.ops.wm.save_as_mainfile(filepath=str(OUT / (STEM + '.blend')))
    for name, cam in ([] if '--export-only' in OPTIONS else cameras.items()):
        scene.camera = cam
        suffix = '-draft' if DRAFT else ''
        scene.render.filepath = str(OUT / (STEM + '-' + name + suffix + '.png'))
        bpy.ops.render.render(write_still=True)
    if not DRAFT:
        export_cycle(root, groups)


if __name__ == '__main__':
    main()
