"""Build the original ATLAS expedition car with Blender, then export its game rig.

Run: /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-car.py
Coordinates below use game axes: X right, Y up, Z forward; p() maps to Blender.
The editable source retains named parts and modifiers. Export batches by material
inside Body and each independent wheel spinner, without baking the animation rig.
"""
import bpy
import math
import json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'vehicles'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in list(bpy.data.materials):
    bpy.data.materials.remove(block)

def p(v):
    return Vector((v[0], -v[2], v[1]))

def mat(name, color, metal=0, rough=.4, emission=0):
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
    if name == 'Paint_Copper':
        bs.inputs['Coat Weight'].default_value = .4
        bs.inputs['Coat Roughness'].default_value = .22
    return m

paint = mat('Paint_Copper', (.53, .19, .058), .38, .3)
ivory = mat('Roof_Ivory', (.76, .75, .63), .12, .32)
rubber = mat('Rubber', (.019, .024, .025), 0, .83)
trim = mat('Graphite', (.042, .058, .057), .38, .48)
alloy = mat('Brushed_Alloy', (.47, .52, .51), .8, .26)
glass = mat('Smoked_Glass', (.026, .072, .085), .5, .16)
head = mat('Headlamp', (.95, .86, .61), .1, .18, .45)
brake = mat('Brake_Lamp', (.65, .019, .008), .15, .23, .25)
amber = mat('Amber_Lens', (.95, .29, .018), .1, .28, .22)
canvas = mat('Canvas_Olive', (.12, .19, .115), 0, .92)

def empty(name, loc=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.location = p(loc)
    o.parent = parent
    return o

root = empty('Atlas_Expedition')
root['asset'] = 'ATLAS 4x4 / original Blender expedition vehicle'
root['forward'] = '+Z in glTF'; root['wheelRadius'] = .57
body = empty('Body', parent=root)
parent = body

def finish(o, name, material, bevel=0, smooth=True):
    o.name = name
    o.parent = parent
    o.data.materials.append(material)
    if bevel:
        mod = o.modifiers.new('Machined edge radius', 'BEVEL')
        mod.width = bevel; mod.segments = 3
    if smooth:
        for face in o.data.polygons:
            face.use_smooth = True
        mod = o.modifiers.new('Weighted surface normals', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True; mod.weight = 50
    return o

def box(name, loc, size, material, bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=p(loc))
    o = bpy.context.object
    o.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, name, material, bevel)

def mesh(name, verts, faces, material, bevel=0, smooth=False):
    m = bpy.data.meshes.new(name)
    m.from_pydata([p(v) for v in verts], [], faces); m.update()
    o = bpy.data.objects.new(name, m); bpy.context.collection.objects.link(o)
    # Consistent outward normals for lofts, wheel arches and closed profiles.
    import bmesh
    bm = bmesh.new(); bm.from_mesh(m)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(m); bm.free()
    return finish(o, name, material, bevel, smooth)

def beam(name, a, b, radius, material, vertices=12):
    a, b = p(a), p(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=(b-a).length, location=(a+b)/2)
    o = bpy.context.object; o.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    return finish(o, name, material, min(radius * .25, .012))

def cylinder(name, loc, radius, depth, material, axis='X', vertices=48, bevel=.01):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=p(loc))
    o = bpy.context.object
    direction = p({'X': (1,0,0), 'Y':(0,1,0), 'Z':(0,0,1)}[axis])
    o.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
    return finish(o, name, material, bevel)

def torus(name, loc, major, minor, material, axis='X', segments=48, rings=10):
    bpy.ops.mesh.primitive_torus_add(major_segments=segments, minor_segments=rings, major_radius=major, minor_radius=minor, location=p(loc))
    o = bpy.context.object
    o.rotation_euler = p({'X': (1,0,0), 'Y':(0,1,0), 'Z':(0,0,1)}[axis]).to_track_quat('Z','Y').to_euler()
    return finish(o, name, material)

def tube(name, points, radius, material):
    c = bpy.data.curves.new(name, 'CURVE'); c.dimensions = '3D'
    c.bevel_depth = radius; c.bevel_resolution = 2; c.resolution_u = 1
    s = c.splines.new('POLY'); s.points.add(len(points)-1)
    for q, v in zip(s.points, points): q.co = (*p(v), 1)
    o = bpy.data.objects.new(name, c); bpy.context.collection.objects.link(o)
    o.parent = parent; c.materials.append(material)
    return o

def loft(name, rings, material, bevel=.035):
    # Rings: height, half-width, rear, front.
    verts = []
    for y,w,b,f in rings:
        verts.extend([(-w,y,b),(w,y,b),(w,y,f),(-w,y,f)])
    faces = [(0,3,2,1)]
    for r in range(len(rings)-1):
        for i in range(4):
            a=r*4+i; b=r*4+(i+1)%4
            faces.append((a,b,b+4,a+4))
    t=(len(rings)-1)*4; faces.append((t,t+1,t+2,t+3))
    return mesh(name,verts,faces,material,bevel,True)

def text(name, value, loc, size, material, facing='rear'):
    c=bpy.data.curves.new(name,'FONT'); c.body=value; c.align_x='CENTER'; c.align_y='CENTER'
    c.size=size; c.extrude=.0008; c.bevel_depth=.0004
    o=bpy.data.objects.new(name,c); bpy.context.collection.objects.link(o)
    o.location=p(loc); o.parent=parent; c.materials.append(material)
    # Text local X runs right; local Y runs upwards.
    o.rotation_euler=(math.pi/2,0,math.pi if facing=='rear' else 0)
    return o

# A continuous tapered shell, with actual cut-out wheel wells.
shell=loft('Pressed aluminium body',[(.59,.86,-1.97,1.98),(.83,1.01,-2.04,2.08),(1.34,1.005,-2.0,2.035),(1.49,.945,-1.96,1.96)],paint,.045)
for z in (-1.37,1.37):
    cutter=cylinder('Wheel arch tool',(0,.57,z),.66,3,trim,vertices=64,bevel=0)
    mod=shell.modifiers.new('Open wheel well','BOOLEAN'); mod.operation='DIFFERENCE'; mod.object=cutter
    bpy.context.view_layer.objects.active=shell
    # Apply booleans after the shell bevel; the fender lip covers the cut edge.
    for previous in list(shell.modifiers):
        bpy.ops.object.modifier_apply(modifier=previous.name)
    bpy.data.objects.remove(cutter,do_unlink=True)
box('Underbody skid pan',(0,.55,0),(1.64,.16,3.7),trim,.05)
for x in (-.66,.66): box('Chassis rail',(x,.43,0),(.11,.15,3.5),rubber)
for z in (-1.37,1.37):
    beam('Live axle',(-1.02,.53,z),(1.02,.53,z),.07,trim)
    cylinder('Differential',(0,.53,z),.17,.29,trim,'X',24)

# Wheel arch lips are curved extruded bands, not blocks sitting above tires.
for side in (-1,1):
    for z in (-1.37,1.37):
        verts=[]; count=32
        for x,r in [(side*.974,.66),(side*1.095,.66),(side*1.095,.748),(side*.974,.748)]:
            for i in range(count+1):
                a=math.pi*i/count
                verts.append((x,.57+math.sin(a)*r,z+math.cos(a)*r))
        faces=[]; stride=count+1
        for j in range(4):
            for i in range(count):
                a=j*stride+i; b=((j+1)%4)*stride+i
                faces.append((a,a+1,b+1,b))
        faces.extend([(0,stride,2*stride,3*stride),(count,2*stride-1,3*stride-1,4*stride-1)])
        mesh('Satin arch flare',verts,faces,trim,.01,True)
        # Small visible flush rivets around the arch.
        for i in range(1,6):
            a=math.pi*i/6
            cylinder('Fender fastener',(side*1.108,.57+math.sin(a)*.71,z+math.cos(a)*.71),.017,.012,alloy,vertices=8,bevel=.003)
        box('Flexible mud flap',(side*1.03,.47,z-.53),(.29,.39,.05),rubber,.015)
    box('Rock slider',(side*1.035,.55,0),(.18,.13,1.6),trim,.045)
    box('Step tread',(side*1.11,.625,-.04),(.2,.025,1.12),rubber,.008)
    for zz in [i*.14 for i in range(-3,4)]: box('Step grip',(side*1.12,.64,zz),(.14,.012,.027),alloy,.004)

# Solid window envelope, separately inset dark glazing, and slender ivory pillars.
loft('Cabin frame',[(1.46,.927,-1.91,.73),(2.24,.79,-1.74,.27)],ivory,.045)
loft('Floating roof',[(2.22,.8,-1.77,.29),(2.29,.855,-1.81,.35),(2.35,.83,-1.79,.32)],ivory,.04)
# Front and rear glass quads, kept slightly above the frame surface.
mesh('Panoramic windshield',[(-.866,1.54,.688),(.866,1.54,.688),(.743,2.17,.32),(-.743,2.17,.32)],[(0,1,2,3)],glass)
mesh('Rear glass',[(-.862,1.56,-1.899),(.862,1.56,-1.899),(.753,2.16,-1.768),(-.753,2.16,-1.768)],[(0,3,2,1)],glass)
for side in (-1,1):
    def sidepoint(y,z,offset=.008): return (side*(.927-(y-1.46)/.78*.137+offset),y,z)
    mesh('Front door glass',[sidepoint(1.55,-.46),sidepoint(1.55,.625),sidepoint(2.16,.259),sidepoint(2.16,-.46)],[(0,1,2,3)],glass)
    mesh('Rear quarter glass',[sidepoint(1.55,-1.81),sidepoint(1.55,-.575),sidepoint(2.16,-.575),sidepoint(2.16,-1.68)],[(0,1,2,3)],glass)
    # Rubber window seals and body panel shut lines.
    for z in (-.51,): beam('B pillar',sidepoint(1.49,z,.012),sidepoint(2.23,z,.012),.028,trim)
    beam('Beltline moulding',(side*.949,1.475,-1.88),(side*.949,1.475,.73),.018,trim)
    tube('Door shut line',[(side*1.013,1.35,.57),(side*1.015,.86,.57),(side*.98,.74,.44),(side*.98,.74,-.49),(side*1.015,.9,-.51),(side*1.013,1.36,-.51)],.007,rubber)
    box('Handle recess',(side*1.021,1.27,-.29),(.015,.08,.25),rubber,.02)
    box('Door handle',(side*1.048,1.283,-.29),(.046,.035,.17),alloy,.013)
    beam('Mirror arm',(side*.967,1.53,.57),(side*1.18,1.65,.53),.025,trim)
    box('Mirror housing',(side*1.2,1.68,.53),(.22,.2,.12),paint,.045)
    box('Mirror glass',(side*1.2,1.68,.461),(.177,.143,.014),alloy,.024)
    box('Side protection strip',(side*1.018,.92,-.03),(.025,.055,1.17),trim,.008)
    # Coach stripe under the windows.
    box('Ivory coach stripe',(side*1.008,1.372,-.43),(.016,.035,2.9),ivory,.005)
    box('Front marker',(side*1.023,1.2,1.91),(.018,.055,.12),amber,.012)
    for z in (.82,.94,1.06): box('Fender cooling slot',(side*1.024,1.32,z),(.022,.027,.069),rubber,.007)

# Bonnet with raised central pressing and exposed latches.
loft('Bonnet',[(1.465,.935,.73,1.98),(1.535,.885,.75,1.92)],paint,.035)
loft('Bonnet power ridge',[(1.53,.48,.84,1.83),(1.565,.42,.87,1.77)],paint,.02)
for s in (-1,1):
    box('Bonnet latch',(s*.94,1.446,1.64),(.037,.09,.09),trim,.013)
    beam('Wiper arm',(s*.43,1.552,.715),(s*.25,1.66,.65),.012,trim)
    beam('Wiper blade',(s*.25-.2,1.66,.653),(s*.25+.2,1.66,.653),.014,rubber)
box('Grille surround',(0,1.15,2.053),(1.82,.49,.11),trim,.065)
box('Recessed radiator',(0,1.14,2.113),(.94,.34,.026),rubber,.025)
for i in range(-7,8): box('Grille vertical blade',(i*.06,1.14,2.134),(.018,.29,.03),alloy,.004)
for s in (-1,1):
    cylinder('Headlamp bezel',(s*.704,1.177,2.118),.221,.078,alloy,'Z',48)
    cylinder('Headlamp gasket',(s*.704,1.177,2.164),.195,.024,rubber,'Z',48)
    cylinder('Headlamp lens',(s*.704,1.177,2.18),.172,.026,head,'Z',48)
    torus('Headlamp halo',(s*.704,1.177,2.2),.143,.01,head,'Z')
    for xoff in (-.07,0,.07): box('Lens fluting',(s*.704+xoff,1.177,2.199),(.005,.235,.006),ivory,.002)
    box('Front signal',(s*.77,.85,2.102),(.22,.092,.045),amber,.02)
box('Front bumper',(0,.675,2.12),(2.18,.21,.26),trim,.055)
box('Front skid plate',(0,.484,1.989),(1.05,.17,.28),alloy,.03)
for x in (-.33,-.11,.11,.33): box('Skid plate slot',(x,.462,2.136),(.095,.043,.014),trim,.009)
box('Winch housing',(0,.811,2.21),(.51,.18,.21),trim,.03)
cylinder('Winch drum',(0,.817,2.25),.075,.28,alloy,'X',24)
for s in (-1,1): torus('Recovery shackle',(s*.71,.62,2.283),.056,.016,amber,'Z',20,8)
text('Bonnet badge','A T L A S',(0,1.402,2.087),.092,ivory,'front')

# Rear lamp clusters, split tailgate, number plate, tow hitch and exhaust.
box('Tailgate inset',(0,1.157,-2.039),(1.52,.48,.035),paint,.03)
for side in (-1,1):
    box('Rear light housing',(side*.84,1.13,-2.047),(.225,.43,.073),trim,.04)
    box('Rear stop lamp',(side*.84,1.218,-2.092),(.177,.175,.035),brake,.027)
    box('Rear indicator',(side*.84,1.058,-2.092),(.177,.083,.035),amber,.016)
    box('Reversing lens',(side*.84,.968,-2.092),(.177,.06,.035),ivory,.01)
    box('Tailgate hinge',(side*.69,.947,-2.078),(.12,.056,.06),alloy,.012)
box('Rear bumper',(0,.66,-2.135),(2.14,.21,.24),trim,.055)
box('Rear number plate',(0,.684,-2.269),(.5,.132,.019),ivory,.01)
text('Registration','ATLAS 01',(0,.685,-2.282),.07,trim)
box('Tow receiver',(0,.413,-2.18),(.12,.12,.3),trim,.015)
beam('Exhaust pipe',(-.67,.4,-1.72),(-.67,.37,-2.195),.052,alloy)
cylinder('Exhaust opening',(-.67,.37,-2.199),.037,.01,rubber,'Z',24,0)

# Roof basket with slats, lashing straps, a hard case, and rolled canvas.
for s in (-1,1):
    for z in (-1.45,.08): box('Rack foot',(s*.69,2.375,z),(.12,.11,.15),rubber,.02)
    tube('Roof basket rail',[(s*.73,2.58,.17),(s*.77,2.59,.07),(s*.77,2.59,-1.53),(s*.72,2.58,-1.63)],.028,trim)
for y in (2.44,2.58):
    for z in (.16,-1.62): beam('Basket end rail',(-.72,y,z),(.72,y,z),.025,trim)
for x in [i*.17 for i in range(-4,5)]: beam('Basket floor slat',(x,2.445,-1.59),(x,2.445,.12),.016,trim)
for s in (-1,1):
    for z in (-1.55,-.77,.1): beam('Basket upright',(s*.755,2.44,z),(s*.755,2.59,z),.018,trim)
box('Expedition hard case',(.28,2.605,-.97),(.77,.3,.97),canvas,.06)
box('Case lid',(.28,2.776,-.97),(.8,.073,1.0),canvas,.034)
for z in (-1.3,-.64):
    box('Case strap top',(.28,2.819,z),(.79,.017,.049),rubber,.005)
    for x in (-.115,.675): box('Case strap vertical',(x,2.65,z),(.018,.31,.049),rubber,.005)
    box('Strap buckle',(.691,2.66,z),(.025,.07,.073),alloy,.006)
cylinder('Canvas bedroll',(-.43,2.603,-.88),.16,1.2,canvas,'Z',32,.01)
for z in (-1.29,-.49): torus('Bedroll strap',(-.43,2.603,z),.154,.019,rubber,'Z',32,8)
for x in (-.5,.5):
    box('Auxiliary lamp pod',(x,2.49,.295),(.28,.14,.105),trim,.025)
    box('Auxiliary lens',(x,2.49,.354),(.228,.09,.025),head,.014)

# A hand-built radial tire cross-section gives rounded shoulders and flat tread.
def wheel(prefix, outward=1):
    profile=[(-.2,.34),(-.212,.41),(-.185,.505),(-.135,.55),(.135,.55),(.185,.505),(.212,.41),(.2,.34)]
    verts=[]; n=48
    for x,r in profile:
        for i in range(n):
            a=i*math.tau/n; verts.append((x,math.cos(a)*r,math.sin(a)*r))
    faces=[]
    for j in range(len(profile)):
        for i in range(n):
            faces.append((j*n+i,j*n+(i+1)%n,((j+1)%len(profile))*n+(i+1)%n,((j+1)%len(profile))*n+i))
    mesh(prefix+' tire carcass',verts,faces,rubber,0,True)
    for i in range(32):
        a=math.tau*i/32
        for row in (-1,0,1):
            aa=a+(abs(row)*.037)
            o=box(prefix+' tread block',(row*.119,math.cos(aa)*.55,math.sin(aa)*.55),(.101,.039,.082),rubber,.008)
            o.rotation_euler.x=-aa
    for side in (-1,1):
        torus(prefix+' bead',(side*.206,0,0),.337,.017,rubber)
        torus(prefix+' sidewall ridge',(side*.201,0,0),.433,.006,rubber)
        cylinder(prefix+' rim barrel',(0,0,0),.325,.355,trim,vertices=48)
        torus(prefix+' polished rim lip',(side*.212,0,0),.31,.024,alloy)
    # Six open spokes over a recessed dark brake drum, with bolt circle.
    cylinder(prefix+' brake rotor',(outward*.158,0,0),.269,.025,alloy,vertices=48)
    cylinder(prefix+' centre',(outward*.218,0,0),.101,.065,trim,vertices=24)
    for i in range(6):
        a=i*math.tau/6
        beam(prefix+' alloy spoke',(outward*.219,math.cos(a)*.08,math.sin(a)*.08),(outward*.214,math.cos(a+.12)*.288,math.sin(a+.12)*.288),.032,ivory,8)
        cylinder(prefix+' lug nut',(outward*.259,math.cos(a)*.069,math.sin(a)*.069),.019,.02,alloy,vertices=6,bevel=.003)
    cylinder(prefix+' hub cap',(outward*.257,0,0),.045,.02,alloy,vertices=24)

wheel_groups=[]
for side,label in [(-1,'L'),(1,'R')]:
    for z,end in [(1.37,'F'),(-1.37,'R')]:
        pivot=empty('Wheel_'+end+label,(side*1.04,.57,z),root)
        spinner=empty('Spinner_'+end+label,parent=pivot)
        parent=spinner; wheel(end+label,side); wheel_groups.append(spinner)
parent=body
spare=empty('Spare mount',(.13,1.32,-2.18),body)
spare.rotation_euler.z=math.pi/2
parent=spare; wheel('Spare',1)
parent=body
box('Tailgate handle',(-.57,1.37,-2.081),(.18,.046,.047),trim,.012)
beam('Rear wiper',(-.47,1.65,-1.9),(.12,1.67,-1.88),.012,trim)

# Save the editable model before any export batching.
scene=bpy.context.scene
scene.unit_settings.system='METRIC'
scene.world.color=(.22,.22,.22)
scene.render.engine='CYCLES'; scene.cycles.samples=32
scene.cycles.use_denoising=True
scene.render.resolution_x=1500; scene.render.resolution_y=1100; scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
bpy.context.preferences.filepaths.save_version=0
source_parts=len([o for o in root.children_recursive if o.type in {'MESH','CURVE','FONT'}])
# A studio scene remains in the blend, but is excluded from glTF export.
parent=None
floor=box('Studio floor',(0,-.08,0),(200,.1,200),mat('Studio',(.065,.088,.086),0,.68),0)
def area(name,loc,power,size,target=(0,1,0)):
    d=bpy.data.lights.new(name,'AREA'); d.energy=power; d.shape='DISK'; d.size=size
    o=bpy.data.objects.new(name,d); scene.collection.objects.link(o); o.location=p(loc)
    o.rotation_euler=(p(target)-o.location).to_track_quat('-Z','Y').to_euler()
area('Large softbox',(-4,7,4),1500,5)
area('Cool fill',(4,4,1),1000,4)
area('Roof rim',(1,6,-5),1900,3)
camdata=bpy.data.cameras.new('Hero camera'); cam=bpy.data.objects.new('Hero camera',camdata)
scene.collection.objects.link(cam); cam.location=p((-6.4,4.2,7.3))
cam.rotation_euler=(p((0,1.22,0))-cam.location).to_track_quat('-Z','Y').to_euler()
camdata.type='ORTHO'; camdata.ortho_scale=7.15; scene.camera=cam
# Start Blender in a useful material-preview view of the model.
bpy.ops.object.select_all(action='DESELECT'); root.select_set(True); bpy.context.view_layer.objects.active=root
for screen in bpy.data.screens:
    for area_ui in screen.areas:
        if area_ui.type=='VIEW_3D':
            area_ui.spaces.active.region_3d.view_distance=7
            area_ui.spaces.active.region_3d.view_location=p((0,1.2,0))
            area_ui.spaces.active.shading.type='MATERIAL'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'atlas-expedition.blend'))
scene.render.filepath=str(OUT/'atlas-preview.png')
bpy.ops.render.render(write_still=True)

# The same exporter can be run on a manually edited .blend without rebuilding it.
import sys
sys.path.insert(0, str(ROOT / 'scripts'))
from export_car import export_car
export_car(root, OUT, source_parts)
