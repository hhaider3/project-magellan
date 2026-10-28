"""Build the Roadster (Rocket trim, with cold-gas thrusters) with Blender, then export it.

Run: /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/build-roadster.py
Coordinates below use game axes: X right, Y up, Z forward; p() maps to Blender.
Original geometry studied from Tesla's October 2026 Roadster photographs:
https://www.tesla.com/roadster (front, profile, canopy and rear-deck views).
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
root['asset'] = 'Roadster Rocket / reference-sculpted Blender model, revision 3'
root['revision'] = 3
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

# ---- Sculpted body. Longitudinal splines keep the fenders continuous while
# the cross-section preserves the hood, shoulder and lower door creases.
# z, outer width, sill height, belt height, fender crown, hood/deck centre
STATIONS = [
    (2.23, .79, .18, .36, .45, .42),
    (2.12, .91, .14, .39, .51, .47),
    (1.91, .98, .13, .47, .63, .54),
    (1.66, .999, .13, .61, .75, .60),
    (1.41, 1.0, .13, .70, .80, .65),
    (1.17, .995, .13, .67, .80, .69),
    (.90, .982, .13, .60, .78, .735),
    (.58, .967, .14, .60, .785, .77),
    (.05, .956, .15, .63, .80, .795),
    (-.48, .977, .16, .66, .824, .81),
    (-.94, .998, .16, .70, .85, .82),
    (-1.19, 1.0, .17, .75, .873, .82),
    (-1.41, 1.0, .18, .79, .888, .815),
    (-1.65, .99, .19, .76, .881, .81),
    (-1.94, .969, .22, .66, .845, .80),
    (-2.14, .922, .29, .61, .785, .78),
]

def spline(a, b, c, d, t):
    return .5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t)

def sample(rows, z):
    for i in range(len(rows)-1):
        b, c = rows[i], rows[i+1]
        if c[0] <= z <= b[0]:
            t = (b[0]-z)/(b[0]-c[0]); a = rows[max(0, i-1)]; d = rows[min(len(rows)-1, i+2)]
            return [z]+[spline(a[k], b[k], c[k], d[k], t) for k in range(1, len(b))]
    return list(rows[0] if z > rows[0][0] else rows[-1])

def body_profile(z):
    _, w, sill, belt, crown, deck = sample(STATIONS, z)
    return [(0, sill), (w*.78, sill), (w*.94, sill+.028),
            (w*.98, sill+.11), (w, belt), (w*.978, crown-.035),
            (w*.92, crown), (w*.76, crown*.66+deck*.34),
            (w*.57, deck+.012), (w*.28, deck+.008), (0, deck)]

def curve_point(points, u):
    i=min(len(points)-2,int(u)); t=u-i
    a,b,c,d=points[max(0,i-1)],points[i],points[i+1],points[min(len(points)-1,i+2)]
    # Bounded interpolation preserves the tyre/roof envelope and panel creases.
    return tuple(max(min(b[k],c[k]),min(max(b[k],c[k]),spline(a[k],b[k],c[k],d[k],t))) for k in range(len(b)))

def dense_profile(points, steps=3):
    return [curve_point(points,i+j/steps) for i in range(len(points)-1) for j in range(steps)]+[points[-1]]

def subtract(target, cutter, name):
    bpy.context.view_layer.objects.active=target
    mod=target.modifiers.new(name,'BOOLEAN');mod.operation='DIFFERENCE';mod.object=cutter
    mod.material_mode='TRANSFER'
    for previous in list(target.modifiers): bpy.ops.object.modifier_apply(modifier=previous.name)
    bpy.data.objects.remove(cutter,do_unlink=True)

zs = [a[0]+(b[0]-a[0])*j/6 for a, b in zip(STATIONS, STATIONS[1:]) for j in range(6)]+[STATIONS[-1][0]]
shell = loft('Sculpted monocoque', [mirrored(z, dense_profile(body_profile(z))) for z in zs], paint, 0)
# True open arches with clean circular edges and black inner walls.
for z, wheel in ((FRONT_AXLE, FRONT), (REAR_AXLE, REAR)):
    for s in (-1, 1):
        cutter = cylinder('Arch cutter', (s*1.08, wheel['radius'], z), wheel['radius']+.027, .72, carbon, vertices=96, bevel=0)
        mod = shell.modifiers.new('Open arch', 'BOOLEAN'); mod.operation='DIFFERENCE'; mod.object=cutter
        mod.material_mode='TRANSFER'
        bpy.context.view_layer.objects.active=shell
        for previous in list(shell.modifiers): bpy.ops.object.modifier_apply(modifier=previous.name)
        bpy.data.objects.remove(cutter, do_unlink=True)
        # The lip follows the cut, rather than a painted circle over a solid side.
        pts=[]
        for i in range(41):
            a=-.35+(math.pi+.7)*i/40
            zz=z+math.cos(a)*(wheel['radius']+.029)
            yy=wheel['radius']+math.sin(a)*(wheel['radius']+.029)
            w=sample(STATIONS, zz)[1]
            pts.append((s*(w+.001), yy, zz))
        tube('Arch edge', pts, .006, paint)
        # Shadowed well behind the tyre, recessed from the outer skin.
        pts=[(s*.745, wheel['radius']+math.sin(a)*(wheel['radius']+.035), z+math.cos(a)*(wheel['radius']+.035)) for a in [i*math.pi/32 for i in range(33)]]
        tube('Inner arch liner', pts, .014, carbon)

# ---- Gold wraparound glass with a tapered fastback, defined A/B pillars and
# flush perimeter seals. Long side glazing is a defining reference feature.
# z, base width, base height, shoulder width/height, crown width/height, centre
CANOPY = [
    (.91, .79, .745, .76, .754, .60, .762, .766),
    (.66, .842, .777, .76, .832, .60, .87, .882),
    (.35, .858, .799, .735, .927, .58, .988, 1.004),
    (.02, .858, .815, .71, 1.006, .57, 1.071, 1.086),
    (-.30, .854, .828, .70, 1.027, .565, 1.09, 1.10),
    (-.64, .846, .840, .70, 1.025, .558, 1.078, 1.092),
    (-.92, .828, .850, .695, 1.003, .548, 1.046, 1.06),
    (-1.19, .78, .850, .66, .961, .515, .995, 1.006),
    (-1.47, .67, .842, .58, .901, .455, .923, .932),
    (-1.73, .49, .823, .46, .839, .36, .85, .855),
]
def canopy_half(z):
    _, w, h, sw, sh, rw, rh, crown = sample(CANOPY, z)
    return [(0,h-.018), (w,h-.018), (w,h), (sw,sh), (rw,rh), (rw*.5, crown-.002), (0,crown)]
czs=[a[0]+(b[0]-a[0])*j/6 for a,b in zip(CANOPY,CANOPY[1:]) for j in range(6)]+[CANOPY[-1][0]]
canopy=loft('Panoramic gold canopy', [mirrored(z, dense_profile(canopy_half(z),4)) for z in czs], glass, 0)
for mod in list(canopy.modifiers): canopy.modifiers.remove(mod)
def canopy_side(z,q,s,offset=.005):
    # q=0 at roof rail, q=1 at beltline; exactly follows the glass shell.
    x,y=curve_point(canopy_half(z),4-2*q)
    return (s*(x+offset*.35),y+offset,z)

for s in (-1,1):
    tube('Glass lower seal', [(s*sample(CANOPY,z)[1], sample(CANOPY,z)[2]+.002,z) for z in czs], .005, carbon)
    tube('Titanium roof rail', [(s*sample(CANOPY,z)[5], sample(CANOPY,z)[6]+.004,z) for z in czs if -.84<=z<=-.19], .004, titanium)
    tube('A pillar', [canopy_side(.71-.9*i/12,1-i/12,s) for i in range(13)], .007, paint)
    tube('B pillar seal', [canopy_side(-.73-.1*i/8,1-i/8,s) for i in range(9)], .008, carbon)
    # A fitted surface, with the same cross-sections as the canopy, avoids
    # floating triangles or intersections with the rear quarter window.
    verts=[]; nu,nv=16,16
    for j in range(nv+1):
        t=j/nv
        for i in range(nu+1):
            q=i/nu; start=-.86-.61*q; z=start+(-1.73-start)*t
            verts.append(canopy_side(z,q,s,.007))
    faces=[(j*(nu+1)+i,j*(nu+1)+i+1,(j+1)*(nu+1)+i+1,(j+1)*(nu+1)+i) for j in range(nv) for i in range(nu)]
    mesh('Fitted rear buttress',verts,faces,paint,0,True)
    tube('Quarter window seal',[canopy_side(-.86-.61*i/12,i/12,s,.009) for i in range(13)],.004,carbon)
    tube('Rear deck shut line', [(s*.91,.838,-1.94),(s*.74,.81,-2.00),(s*.55,.807,-2.015)],.003,carbon)
# The transverse roof seam is subtle; the glazing remains uninterrupted at centre.
tube('Roof panel seam', [(-.56,1.094,-.30),(-.28,1.103,-.30),(0,1.104,-.30),(.28,1.103,-.30),(.56,1.094,-.30)],.003,carbon)

# ---- Body seams and flush details. Project the door lines onto the side loft.
def side_at(z,y,s,offset=.004):
    profile=body_profile(z)
    for (x0,y0),(x1,y1) in zip(profile[2:5],profile[3:6]):
        if y0<=y<=y1:
            return (s*(x0+(x1-x0)*(y-y0)/(y1-y0)+offset),y,z)
    return (s*(sample(STATIONS,z)[1]+offset),y,z)
for s in (-1,1):
    door=[(.66,.71),(.60,.57),(.53,.32),(.47,.245),(.15,.25),(-.25,.265),(-.64,.29),(-.75,.49),(-.83,.72)]
    tube('Door perimeter', [side_at(z,y,s) for z,y in door],.0035,carbon)
    # Gold side marker and a flush release, not protruding door handles.
    box('Flush door release',(s*.967,.723,-.54),(.009,.021,.11),titanium,.003)
    box('Side marker recess',(s*.99,.65,.96),(.008,.022,.16),carbon,.004)
    box('Side marker',(s*.995,.65,.96),(.006,.008,.10),caliper,.002)
    mesh('Recessed sill',[(s*.995,.245,.93),(s*1.005,.30,-.91),(s*1.005,.16,-.96),(s*.91,.13,.97)],[(0,1,2,3)],carbon,.006)
    mesh('Sill aero edge',[(s*.94,.16,.99),(s*1.01,.18,-.95),(s*1.015,.125,-.98),(s*.94,.105,.99)],[(0,1,2,3)],carbon,.004)

# ---- Front: a broad blank wedge, angular light pockets and a recessed lower
# mouth. The long hood's diagonal edges converge into the front opening.
intake=box('Intake cutter',(0,.27,2.23),(1.36,.205,.40),carbon,.035)
# Evaluate the cutter's rounded corners before the difference.
bpy.context.view_layer.objects.active=intake
for mod in list(intake.modifiers): bpy.ops.object.modifier_apply(modifier=mod.name)
subtract(shell,intake,'Recessed front intake')
box('Intake back wall',(0,.27,2.035),(1.35,.20,.012),throat,.025)
for x in [i*.06 for i in range(-10,11)]:
    box('Intake grille fin',(x,.27,2.065),(.008,.14,.025),graphite,.002)
mesh('Splitter lip',[(-.89,.15,2.08),(-.72,.12,2.26),(.72,.12,2.26),(.89,.15,2.08),(.84,.11,2.08),(.66,.095,2.25),(-.66,.095,2.25),(-.84,.11,2.08)],
     [(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3)],carbon,.006)
def hood_y(x,z):
    row=dense_profile(body_profile(z)[4:]);x=abs(x)
    for (x0,y0),(x1,y1) in zip(row,row[1:]):
        if x1<=x<=x0: return y1+(y0-y1)*(x-x1)/(x0-x1)
    return row[-1][1]
def hood_patch(name,corners,material,offset):
    verts=[];n=5
    for j in range(n+1):
        for i in range(n+1):
            u,v=i/n,j/n
            x=(corners[0][0]*(1-u)+corners[1][0]*u)*(1-v)+(corners[3][0]*(1-u)+corners[2][0]*u)*v
            z=(corners[0][1]*(1-u)+corners[1][1]*u)*(1-v)+(corners[3][1]*(1-u)+corners[2][1]*u)*v
            verts.append((x,hood_y(x,z)+offset,z))
    return mesh(name,verts,[(j*(n+1)+i,j*(n+1)+i+1,(j+1)*(n+1)+i+1,(j+1)*(n+1)+i) for j in range(n) for i in range(n)],material,0,True)
for s in (-1,1):
    # A tapered cavity cut through the fender, with a recessed bed and separate
    # projector optics. The old version only laid a dark face over the paint.
    corners=[(s*.64,2.14),(s*.89,2.04),(s*.85,1.70),(s*.58,1.87)]
    verts=[(x,hood_y(x,z)+dy,z) for dy in (-.060,.18) for x,z in corners]
    cutter=mesh('Lamp cavity cutter',verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],carbon)
    subtract(shell,cutter,'Recessed headlight well')
    hood_patch('Headlight well floor',corners,carbon,-.047)
    # A fine machined surround follows the body, with true wall depth inside it.
    edge=[]
    for a,b in zip(corners,corners[1:]+corners[:1]):
        for j in range(8):
            x=a[0]+(b[0]-a[0])*j/8;z=a[1]+(b[1]-a[1])*j/8
            edge.append((x,hood_y(x,z)+.003,z))
    tube('Headlight bezel',edge+[edge[0]],.004,titanium)
    # Projectors face upward and forward through the cavity; DRLs outline its nose.
    for i in range(3):
        x=s*(.69+i*.058);z=2.045-i*.026;y=hood_y(x,z)-.012
        cylinder('Projector housing',(x,y,z),.022,.020,graphite,(0,.85,.53),32,.002)
        cylinder('Projector lens',(x,y+.010,z+.006),.017,.004,head,(0,.85,.53),32,.001)
    hood_patch('Daylight blade',[(s*.657,2.108),(s*.862,2.024),(s*.856,2.003),(s*.652,2.087)],head,-.006)
    tube('Bonnet seam',[(s*x,hood_y(x,z)+.003,z) for x,z in [(.64,2.12),(.57,1.86),(.55,1.42),(.59,.96)]],.0025,carbon)
    box('Yaw recess',(s*.99,.43,.92),(.012,.13,.17),carbon,.018)

# ---- Rear deck and aero. The working air brake sits close to the deck instead
# of the old tall, square race wing. Its existing node still drives braking.
mesh('Rear fascia',[(-.925,.725,-2.175),(.925,.725,-2.175),(.87,.20,-2.175),(-.87,.20,-2.175)],[(0,1,2,3)],carbon,.006)
box('Taillight shadow line',(0,.752,-2.153),(1.82,.051,.018),carbon,.007)
box('Continuous taillight',(0,.756,-2.166),(1.79,.018,.012),brake,.004)
box('Tail titanium edge',(0,.783,-2.158),(1.8,.006,.012),titanium,.002)
for s in (-1,1):
    box('Reversing lens',(s*.79,.52,-2.173),(.095,.018,.008),lens,.003)
mesh('Sculpted rear bumper', [(-.90,.708,-2.184),(-.48,.708,-2.184),(0,.708,-2.184),(.48,.708,-2.184),(.90,.708,-2.184),
    (-.82,.60,-2.19),(-.48,.55,-2.20),(0,.585,-2.205),(.48,.55,-2.20),(.82,.60,-2.19)],
    [(i,i+1,i+6,i+5) for i in range(4)],paint,.004,True)
box('Tail inset',(0,.621,-2.211),(.29,.095,.012),titanium,.005)
# A rising carbon undertray with separate, tapered diffuser strakes.
mesh('Diffuser ramp',[(-.86,.13,-1.63),(.86,.13,-1.63),(.90,.30,-2.19),(-.90,.30,-2.19)],[(0,1,2,3)],carbon,.005)
for x in (-.84,-.42,0,.42,.84):
    mesh('Diffuser blade',[(x-.009,.13,-1.69),(x-.009,.085,-2.20),(x-.009,.32,-2.19),(x+.009,.13,-1.69),(x+.009,.085,-2.20),(x+.009,.32,-2.19)],
         [(0,1,2),(3,5,4),(0,3,4,1),(1,4,5,2)],carbon,.003)
# Recessed suction fans: axial rings, hubs and actual radial blades.
for x in (-.48,-.16,.16,.48):
    cylinder('Fan cavity',(x,.26,-2.164),.072,.014,throat,(0,0,1),24,0)
    for k in range(5):
        a=k*math.tau/5
        beam('Fan blade',(x+math.cos(a)*.02,.26+math.sin(a)*.02,-2.177),(x+math.cos(a+.35)*.062,.26+math.sin(a+.35)*.062,-2.177),.009,graphite,4)
    cylinder('Fan centre',(x,.26,-2.181),.019,.012,titanium,(0,0,1),12,0)
    # Cylinder axis is along the rear face, not the ground (the old rings lay flat).
    bpy.ops.mesh.primitive_torus_add(major_segments=20,minor_segments=4,major_radius=.073,minor_radius=.006,location=p((x,.26,-2.179)))
    o=bpy.context.object; o.rotation_euler=p((0,0,1)).to_track_quat('Z','Y').to_euler(); finish(o,'Fan shroud',graphite)
WING_Y,WING_Z=.95,-1.98
for s in (-1,1):
    mesh('Air brake support',[(s*.59,.815,-1.78),(s*.59,.81,-2.03),(s*.59,WING_Y,-1.93),(s*.59,WING_Y,-2.00),
                               (s*.615,.815,-1.78),(s*.615,.81,-2.03),(s*.615,WING_Y,-1.93),(s*.615,WING_Y,-2.00)],
         [(0,1,3,2),(4,6,7,5),(0,2,6,4),(1,5,7,3),(2,3,7,6)],carbon,.004)
wing=empty('Rear_Wing',(0,WING_Y,WING_Z),body)
parent=wing
# Coordinates local to the hinge. A curved airfoil with tapered tips.
wrings=[]
for x,chord,rise in [(-.94,.10,-.025),(-.82,.16,0),(0,.17,.006),(.82,.16,0),(.94,.10,-.025)]:
    wrings.append([(x,rise,-chord),(x,rise+.025,-chord*.4),(x,rise+.035,chord*.55),(x,rise+.014,chord),(x,rise-.006,chord*.5)])
loft('Active aero blade',wrings,carbon,.003)
box('Air brake light',(0,.004,-.171),(1.54,.012,.008),brake,.002)
parent=body

# ---- Ten visible cold-gas bells retain the established names and plume axes.
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
    thruster(f'Rear {i+1}',(x,.395,-2.25),(0,0,-1),1.15)
for label,x,z in [('Lift FL',-.78,1.92),('Lift FR',.78,1.92),('Lift RL',-.80,-1.92),('Lift RR',.80,-1.92)]:
    box(label+' recessed socket',(x,.155,z),(.19,.055,.21),carbon,.014)
    thruster(label,(x,.085,z),(0,-1,0),.9)
for label,s in [('Yaw L',-1),('Yaw R',1)]: thruster(label,(s*1.005,.44,.92),(s,0,0),.75)

# ---- Six sculpted turbine spokes, machined lips, brake discs and tread lines.
# Geometry stays within the original tyre envelope so physics still agrees.
def wheel(prefix,spec,outward):
    R,rim,w=spec['radius'],spec['rim'],spec['width']
    profile=[(-w/2+.014,rim+.005),(-w/2,rim+.025),(-w/2+.005,R-.025),(-w/2+.025,R-.004),(-w/2+.04,R),
             (-w*.22-.006,R),(-w*.22,R-.006),(-w*.22+.006,R),(-.006,R),(0,R-.006),(.006,R),(w*.22-.006,R),(w*.22,R-.006),(w*.22+.006,R),(w/2-.04,R),(w/2-.025,R-.004),(w/2-.005,R-.025),(w/2,rim+.025),(w/2-.014,rim+.005)]
    verts=[]; n=80
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
    disc=cylinder(prefix+' drilled rotor',(outward*w*.11,0,0),rim*.80,.016,titanium,vertices=64,bevel=0)
    cutters=[]
    for r,count in [(rim*.60,18),(rim*.70,24)]:
        for k in range(count):
            a=k*math.tau/count
            cutters.append(cylinder('Rotor drilling tool',(outward*w*.11,math.cos(a)*r,math.sin(a)*r),.0045,.06,throat,vertices=8,bevel=0))
    cutters.append(cylinder('Rotor hub opening',(outward*w*.11,0,0),rim*.30,.06,throat,vertices=32,bevel=0))
    bpy.ops.object.select_all(action='DESELECT')
    for o in cutters:o.select_set(True)
    bpy.context.view_layer.objects.active=cutters[0];bpy.ops.object.join()
    subtract(disc,bpy.context.object,'Drilled cooling holes')
    for face in disc.data.polygons: face.use_smooth = abs(face.normal.z) < .95
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
