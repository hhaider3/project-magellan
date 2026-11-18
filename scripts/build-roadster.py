"""Build the Roadster (Rocket trim, with cold-gas thrusters) with Blender, then export it.

Run: /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/build-roadster.py
Coordinates below use game axes: X right, Y up, Z forward; p() maps to Blender.
Geometry follows the white Rocket show car from the October 2026 reveal.
Exterior reference: https://www.tesla.com/roadster
Additional Tesla photographs: https://www.caranddriver.com/photos/a74152579/tesla-roadster-revealed-exterior-gallery/
The published photographs determine the panel outlines. Wheel and suspension
coordinates retain the game scale. The Blender scene opens in the parked pose.
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

FRONT_AXLE, REAR_AXLE = 1.41, -1.41
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

paint = mat('Ano_White', (.78, .795, .82), .34, .28, coat=.32)
glass = mat('Gold_Glass', (.028, .014, .011), .46, .24, coat=.12)
# Tinted, not opaque: the white cockpit shows through, as in the photographs.
glass.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = .96
glass.surface_render_method = 'BLENDED'; glass.use_backface_culling = False
carbon = mat('Carbon', (.009, .011, .014), .18, .34)
titanium = mat('Titanium', (.55, .565, .60), .70, .29)
graphite = mat('Wheel_Graphite', (.033, .037, .044), .73, .265)
rubber = mat('Rubber', (.019, .022, .024), 0, .8)
head = mat('Headlamp', (.9, .94, 1), .1, .15, .6)
brake = mat('Brake_Lamp', (.75, .02, .015), .15, .2, .35)
throat = mat('Thruster_Throat', (.012, .012, .014), .3, .85)
caliper = mat('Caliper_Gold', (.61, .34, .075), .75, .29)
visor = glass.node_tree.nodes['Principled BSDF']
visor.inputs['Specular IOR Level'].default_value = .22
visor.inputs['Specular Tint'].default_value = (.72,.52,.38,1)

def empty(name, loc=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.location = p(loc)
    o.empty_display_size = .07
    o.parent = parent
    return o

root = empty('Roadster_Rocket')
root['asset'] = 'Roadster Rocket / reference-sculpted Blender model, October 2026 reveal, revision 6'
root['revision'] = 6
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

def cylinder(name, loc, radius, depth, material, axis=(1, 0, 0), vertices=32, bevel=.005, caps=True):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=p(loc), end_fill_type='NGON' if caps else 'NOTHING')
    o = bpy.context.object
    o.rotation_euler = p(axis).to_track_quat('Z', 'Y').to_euler()
    return finish(o, name, material, bevel)

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

# The rails below follow the October reveal's profile and overhead photographs.
# At each axle the tyre diameter supplies a second, independent scale reference.
# A rail is a continuous edge from the bumper round the wheel shoulders and
# alongside the glass. Adjacent rails share vertices, including at the sails.
# z, half-width, skirt height, shoulder crease, fender crest height,
# side-window bottom (x,y), side-window top (x,y), central glass edge x,
# roof centre height. The A pillar and rear sail are strips of painted metal.
SECTIONS = [
#   z      w    skirt crease crest   lower glass    upper glass   edge  crown
 (2.20, .708, .214, .434, .440,  .682,.441, .681,.441, .679,.442),
 (1.94, .922, .222, .509, .569,  .813,.577, .642,.530, .631,.528),
 (1.74, .960, .228, .572, .655,  .828,.665, .623,.596, .613,.595),
 (1.53, .982, .231, .616, .704,  .832,.722, .608,.655, .597,.658),
 (1.34, .988, .236, .644, .730,  .838,.748, .593,.702, .580,.706),
 (1.12, .981, .240, .664, .741,  .848,.755, .758,.762, .746,.790),
 ( .87, .971, .246, .684, .743,  .882,.750, .872,.758, .857,.889),
 ( .59, .966, .254, .705, .766,  .892,.778, .775,.927, .756,.987),
 ( .31, .962, .266, .733, .790,  .896,.800, .696,1.040,.674,1.067),
 ( .14, .961, .275, .748, .801,  .897,.813, .667,1.067,.645,1.091),
 (-.10, .964, .293, .766, .821,  .890,.833, .662,1.074,.640,1.100),
 (-.32, .970, .314, .783, .843,  .881,.856, .665,1.065,.638,1.096),
 (-.60, .981, .346, .804, .870,  .864,.884, .680,1.043,.624,1.078),
 (-.83, .993, .378, .821, .895,  .843,.913, .707,1.014,.601,1.052),
 (-1.02,1.000,.409, .833, .922,  .796,.960, .784,.969, .576,1.024),
 (-1.23,1.003,.443, .843, .914,  .811,.944, .771,.950, .514,.989),
 (-1.47,1.001,.491, .851, .893,  .822,.918, .751,.924, .416,.943),
 (-1.67, .987,.551, .854, .877,  .831,.897, .742,.902, .325,.907),
 (-1.80, .966,.603, .851, .865,  .835,.879, .736,.882, .264,.882),
 (-2.01, .940,.668, .833, .838,  .821,.841, .735,.842, .252,.843),
 (-2.16, .906,.707, .806, .811,  .810,.813, .730,.813, .250,.814),
]
NOSE, LAMP_BACK, WINDSCREEN, A_FOOT, SAIL_TIP, WING_FRONT = 2.20, 1.94, 1.34, .87, -1.02, -1.80

def lerp(a, b, t):
    return a + (b-a)*t

def section(z):
    # Monotone cubic tangents keep the changing curvature of the front fender
    # fair between measured stations and preserve the crest at each wheel.
    def tangent(i, col):
        before,here,after=SECTIONS[max(0,i-1)],SECTIONS[i],SECTIONS[min(i+1,len(SECTIONS)-1)]
        if before is here: return (after[col]-here[col])/(after[0]-here[0])
        if after is here: return (here[col]-before[col])/(here[0]-before[0])
        left=(here[col]-before[col])/(here[0]-before[0])
        right=(after[col]-here[col])/(after[0]-here[0])
        return 2*left*right/(left+right) if left*right>0 else 0
    for i,(a,b) in enumerate(zip(SECTIONS,SECTIONS[1:])):
        if b[0]<=z<=a[0]:
            h=b[0]-a[0]
            t=(z-a[0])/h
            return [lerp(a[k],b[k],t*t*(3-2*t))+
                    h*t*(1-t)*((1-t)*tangent(i,k)-t*tangent(i+1,k)) for k in range(1,len(a))]
    raise ValueError(f'Station outside body: {z}')

def rail(z):
    w, skirt, crease, crest, bx, by, tx, ty, gx, roof = section(z)
    # The tip of the nose sweeps back at the corners. The windscreen bows
    # forwards at its foot. Its front side corners meet the A pillars aft.
    nose = max(0, (z-1.53)/(NOSE-1.53))**2
    bow = max(0, 1-abs(z-WINDSCREEN)/.45)
    cowl = max(0, 1-abs(z-A_FOOT)/.47)
    upsweep = max(0, (-z-1.41)/.75)**1.25
    def point(x, y, shift=0):
        setback = .045*(min(x,.68)/.68)**2 + .13*max(0,(x-.68)/.135)
        return x, y, z - nose*setback + shift
    points = [point(0,.115+.14*upsweep), point(w-.104-.068*upsweep,.115+.205*upsweep),
              point(w-.032-.046*upsweep,.15+.229*upsweep),
              point(w-.012+.040*nose,skirt), point(w,crease), point(w-.030,crest),
              point(bx,by), point(tx,ty), point(gx,ty+.003)]
    if WINDSCREEN < z < NOSE:
        roof += .012*math.sin(math.pi*(z-WINDSCREEN)/(NOSE-WINDSCREEN))
    for t in (.72,.38,0):
        points.append(point(gx*t, lerp(roof,ty+.003,t*t), .12*bow*(1-t*t)+.035*cowl*(1-t*t)))
    return points

def crown_arc(half):
    # A tangent arc blends the two planes over the tyre. It stays inside
    # their control polygon, even where the fender narrows to the nose tip.
    a,b,c=[Vector(v) for v in half[4:7]]
    start=b.lerp(a,.38)
    end=b.lerp(c,.38)
    return [tuple(start.lerp(b,t).lerp(b.lerp(end,t),t)) for t in (0,.25,.5,.75,1)]

def surface(z, column, t=0, sign=1):
    r = rail(z)
    a,b = r[column],r[min(column+1,len(r)-1)]
    return (sign*lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t))

def side_point(z, y, sign, offset=.002):
    r = rail(z)
    for a,b in zip(r[1:5], r[2:6]):
        if a[1] <= y <= b[1]:
            t = (y-a[1])/(b[1]-a[1])
            return (sign*(lerp(a[0],b[0],t)+offset), y, lerp(a[2],b[2],t))
    return (sign*(r[4][0]+offset),y,z)

def subtract(target, cutter, name):
    mod = target.modifiers.new(name,'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = cutter
    mod.material_mode = 'TRANSFER'
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter,do_unlink=True)

def sharp_shading(obj, angle):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for face in bm.faces:
        face.smooth = True
    for edge in bm.edges:
        edge.smooth = edge.is_manifold and edge.calc_face_angle(0) < math.radians(angle)
    bm.to_mesh(obj.data)
    bm.free()

def surface_grid(name, rows, material, smooth=False):
    n = len(rows[0])
    faces = [(i*n+k,i*n+k+1,(i+1)*n+k+1,(i+1)*n+k)
             for i in range(len(rows)-1) for k in range(n-1)]
    return mesh(name,[pnt for row in rows for pnt in row],faces,material,0,smooth)

# Closed half sections around the car. Duplicate points on the centreline are
# shared. The lamp pockets and the well beneath the movable deck are built into
# the skin so the moving parts have space to retract.
rows = [r[0] for r in SECTIONS]
rows = sorted(rows + [(a+b)/2 for a,b in zip(rows[1:],rows[2:])] + [WING_FRONT+.004],reverse=True)
rings, faces, slots = [], [], []
for z in rows:
    half = rail(z)
    if z <= WING_FRONT:
        # A recessed wing tray, with a fixed lip just ahead of it.
        half = [(x-(.023 if k in (3,4,5) else 0),y-(.047 if k>=5 else 0),a)
                for k,(x,y,a) in enumerate(half)]
    half=half[:5]+crown_arc(half)+half[6:]
    rings.append(half + [(-x,y,a) for x,y,a in half[-2:0:-1]])
n = len(rings[0])
verts = [v for ring in rings for v in ring]
def face(indices, slot):
    faces.append(indices)
    slots.append(slot)

for j,(a,b) in enumerate(zip(rows,rows[1:])):
    for k in range(n):
        strip = min(k,n-1-k)
        # Four extra strips form the radiused fender crown at rail 5.
        col = strip if strip < 5 else max(5,strip-4)
        # The upper painted shoulder forms the surround of the separate door
        # glass. Behind its pointed tip it becomes the full-width fastback sail.
        glazing = (col >= 8 and a <= WINDSCREEN and b >= WING_FRONT
                   or col == 6 and a <= A_FOOT and b >= SAIL_TIP)
        slot = 2 if glazing else int(col < 3 or (a <= WING_FRONT and col >= 3))
        if b == WING_FRONT and col >= 4:
            slot = 1
        indices = (j*n+k,j*n+(k+1)%n,(j+1)*n+(k+1)%n,(j+1)*n+k)
        if j == 0 and col in (6,7):
            # The painted shutter hinges at its pointed front tip. Displace
            # only the rear two corners of its socket, then close the return.
            cavity = []
            for ident in indices:
                x,y,z = verts[ident]
                cavity.append(len(verts))
                verts.append((x,y-(.063 if ident//n else .004),z))
            face(cavity,1)
            for i,l in enumerate(indices):
                q=(i+1)%4
                # Don't place a web between the two adjacent pocket strips.
                if {l % n, indices[q] % n} in ({11},{n-11}):
                    continue
                face((l,indices[q],cavity[q],cavity[i]),1)
        else:
            face(indices,slot)

# Return the perimeter of each fascia into the body. The bumper beam,
# valance and duct assembly close the ends in front of these recesses.
for j,dz in ((0,-.121),(len(rows)-1,.145)):
    start=len(verts)
    for x,y,z in rings[j]:
        verts.append((x*.957,.46+(y-.46)*.93,z+dz))
    for k in range(n):
        q=(k+1)%n
        face((j*n+k,j*n+q,start+q,start+k),1)
    face(tuple(start+k for k in range(n)),1)
shell = mesh('Bodywork and flush glazing', verts, faces, paint)
shell.data.materials.append(carbon)
shell.data.materials.append(glass)
for polygon,slot in zip(shell.data.polygons,slots):
    polygon.material_index = slot
bm = bmesh.new()
bm.from_mesh(shell.data)
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
bm.to_mesh(shell.data)
bm.free()
for axle,spec in ((FRONT_AXLE,FRONT),(REAR_AXLE,REAR)):
    for sign in (-1,1):
        cutter = cylinder('Wheelhouse tool',(sign*(1.09 if axle>0 else 1.04),spec['radius'],axle),
                          spec['radius']+.021,.56 if axle>0 else .70,carbon,vertices=80,bevel=0)
        subtract(shell,cutter,'Wheel arch')
sharp_shading(shell,18)
# Retain the authored rails as shading breaks on the long side panels.
crease_points={tuple(round(v,5) for v in p((s*r[c][0],r[c][1],r[c][2])))
               for r in rings for c in (3,4,10,11) for s in (-1,1)}
for edge in shell.data.edges:
    a,b=[shell.data.vertices[i].co for i in edge.vertices]
    if abs(a.y-b.y)>.095 and all(tuple(round(u,5) for u in v) in crease_points for v in (a,b)):
        edge.use_edge_sharp=True

# Split the transparent glazing from the opaque shell. Keeping one external
# surface per pane avoids overlapping glass/paint and sorts well in glTF.
bm = bmesh.new()
bm.from_mesh(shell.data)
copy = bm.copy()
bmesh.ops.delete(copy,geom=[f for f in copy.faces if f.material_index != 2],context='FACES')
glass_mesh=bpy.data.meshes.new('Canopy panels')
for f in copy.faces: f.material_index=0
copy.to_mesh(glass_mesh)
copy.free()
panes=bpy.data.objects.new('Copper canopy and door glass',glass_mesh)
bpy.context.collection.objects.link(panes)
panes.parent=body
glass_mesh.materials.append(glass)
bmesh.ops.delete(bm,geom=[f for f in bm.faces if f.material_index == 2],context='FACES')
bm.to_mesh(shell.data)
bm.free()
shell.data.materials.pop(index=2)

# Fine bonded glass seals run along the shared surface rails, including the
# removable roof panel and the short quarter window behind each door.
def along(zs,col,t,sign,lift=.001):
    return [(x,y+lift,z) for x,y,z in (surface(a,col,t,sign) for a in zs)]
def cross_rail(a,first=8):
    half=rail(a)[first:]
    return [(-x,y+.001,z) for x,y,z in half[:-1]] + [(x,y+.001,z) for x,y,z in half[::-1]]

for sign in (-1,1):
    tube('Bonded windscreen edge',along([z for z in rows if WING_FRONT<=z<=WINDSCREEN],8,0,sign),.0028,carbon)
    side_stations=[z for z in rows if SAIL_TIP<=z<=A_FOOT]
    tube('Door window sill seal',along(side_stations,6,0,sign),.003,carbon)
    tube('Roof rail frit',along(side_stations,7,0,sign),.0035,carbon)
    tube('Door glass division',[(x+sign*.002,y,z) for x,y,z in
        [surface(-.26,6,0,sign),surface(-.37,6,.50,sign),surface(-.46,6,1,sign)]],.0045,carbon)
    for top,shoulder,knee,bottom in ((.87,.91,(.85,.48),(.77,.245)),
                                     (-.26,-.24,(-.18,.55),(-.10,.295))):
        start=surface(top,6,0,sign)
        rounding=crown_arc(rail((top+shoulder)/2))[2]
        seam=[start,(sign*rounding[0],rounding[1]+.001,rounding[2]),surface(shoulder,4,0,sign)]
        seam.extend(side_point(z,y,sign,.002) for z,y in (knee,bottom))
        tube('Butterfly door shut line',seam,.0017,carbon)
    # The side-camera/marker is a tapered black flag immediately aft of the tyre.
    patch=[(.84,.662),(1.102,.635),(1.075,.613),(.85,.627)]
    mesh('Side repeater housing',[side_point(z,y,sign,.005) for z,y in patch],[(0,1,2,3)],carbon)
    tube('Amber repeater',[side_point(z,y,sign,.009) for z,y in ((1.06,.630),(.98,.639))],.0045,caliper)
    # Broad dark rocker with a chamfered leading edge and a narrow lower blade.
    skirt=[]
    for z in (.99,.83,.42,-.15,-.57,-.94,-1.01):
        w=section(z)[0]
        front=max(0,(z-.42)/.57)
        skirt.append([(sign*x,y,z) for x,y in ((w-.106,.115),(w-.033,.108),(w-.009,.138),
                      (w-.015+.033*front,.169+.06*front),(w-.067,.154+.055*front))])
    loft('Lower sill extrusion',skirt,carbon,.002)
for z in (WINDSCREEN,.18,-.62,WING_FRONT):
    tube('Glass panel bond',cross_rail(z),.0024,carbon)
tube('Bonnet rear joint',cross_rail(1.53),.0018,carbon)

# The fascia has a white return at each end, a lamp blade over a satin-black
# bumper beam and a shadowed inlet set back behind a projecting splitter.
def nose_z(x):
    return NOSE-.045*(min(abs(x),.68)/.68)**2-.13*max(0,(abs(x)-.68)/.135)
for sign in (-1,1):
    half=rail(NOSE)
    cheek=[half[i] for i in (3,4,5,6,7,8)]
    cheek += [(.697,.219,nose_z(.697))]
    mesh('Folded bumper corner',[(sign*x,y,z+.003) for x,y,z in cheek],[tuple(range(len(cheek)))],paint)
    tube('Bonnet side joint',along([z for z in rows if z >= WINDSCREEN],8,0,sign),.0018,carbon)
nose_x=[-.70,-.675,-.50,-.25,0,.25,.50,.675,.70]
def nose_band(name, profile, material):
    return surface_grid(name,[[(x*f,y,nose_z(x*f)+dz) for f,y,dz in profile] for x in nose_x],material)
nose_band('Front impact beam',[(.972,.440,.005),(.980,.422,.011),(1,.307,.019),(1,.292,.005)],carbon)
nose_band('Daylight reflector',[(.972,.439,.013),(.972,.433,.016)],head)
nose_band('Recessed lower mouth',[(1,.294,.003),(1,.252,-.025),(1,.175,-.024)],throat)
nose_band('Splitter airfoil',[(1.045,.178,-.002),(1.06,.151,.036),(1.054,.131,.039),(1.025,.120,.003)],carbon)
for x in (-.48,-.30,0,.30,.48):
    box('Intake guide',(x,.229,nose_z(x)-.048),(.008,.082,.062),carbon,.002)
for y in (.196,.213,.230):
    nose_band('Intake louvre',[(.958,y,-.035),(.958,y+.005,-.035)],graphite)

LID_PIVOT=(0,.438,2.155)
lids=empty('Lamp_Shutters',LID_PIVOT,body)
lids['openAngle']=-.17
for sign in (-1,1):
    # The aperture follows the diverging edges of the hood and fender. Set
    # individual optical cells in the upright back wall, facing forwards.
    rear=rail(LAMP_BACK)
    for k in range(6):
        t=(k+.5)/6
        a,b=rear[6],rear[8]
        x,y,z=[lerp(u,v,t) for u,v in zip(a,b)]
        box('Projector reflector',(sign*x,y-.022,z+.004),(.023,.023,.018),titanium,.003)
        box('Projector cell',(sign*x,y-.023,z+.016),(.014,.013,.005),head,.002)
    parent=lids
    lidrows=[]
    for z in (NOSE-.003,LAMP_BACK+.003):
        row = [surface(z,col,t,sign) for col,t in ((6,.017),(7,0),(7,.985))]
        lidrows.append([(x-LID_PIVOT[0],y-LID_PIVOT[1]+.0008,a-LID_PIVOT[2]) for x,y,a in row])
    surface_grid('Pop-down headlamp door',lidrows,paint)
    parent=body

# Single-seat Rocket cockpit. The pressure vessel occupies the passenger bay.
# The small instrument binnacles and yoke are visible through the smoked visor.
box('Cabin floor',(0,.32,-.14),(1.46,.075,1.73),carbon,.025)
box('Driver seat squab',(.37,.425,-.22),(.442,.105,.53),paint,.048)
box('Driver seat shell',(.37,.528,-.49),(.432,.33,.10),paint,.040,(-.24,0,0))
box('Shoulder cushion',(.37,.711,-.55),(.389,.22,.10),paint,.042,(-.24,0,0))
box('Head support',(.37,.887,-.61),(.202,.15,.09),paint,.028,(-.24,0,0))
for d in (-1,1):
    box('Seat side bolster',(.37+d*.194,.55,-.28),(.054,.155,.41),graphite,.024)
cylinder('Passenger vessel',(-.345,.574,-.02),.251,1.01,graphite,(0,0,1),48,.060)
for z in (-.37,.32):
    cylinder('Vessel retaining band',(-.345,.574,z),.254,.034,carbon,(0,0,1),48,.004)
loft('Dashboard',[[(x,y,z) for y,z in ((.55,.64),(.625,.79),(.685,1.04),(.55,1.07))] for x in (-.73,0,.73)],carbon,.014)
box('Centre display',(0,.653,.60),(.278,.162,.019),throat,.009,(-.30,0,0))
for x in (.17,.54):
    box('Instrument pod',(x,.694,.764),(.117,.050,.034),graphite,.006)
tube('Yoke rim',[(.37+u,.66+v,.355-v*.34) for u,v in
    ((-.121,.065),(-.150,.055),(-.137,-.025),(-.072,-.069),(.072,-.069),(.137,-.025),(.150,.055),(.121,.065))],.014,carbon)
box('Yoke hub',(.37,.640,.36),(.16,.07,.045),graphite,.010)

# The rear light and fascia sit high on the wedge. The black diffuser is
# narrower than the tail and leaves both rear tyres exposed from behind.
TAIL=-2.16
tail_x=(-.902,-.82,-.57,-.38,-.26,0,.26,.38,.57,.82,.902)
def tail_plane(name,levels,material):
    rows=[]
    for x in tail_x:
        q=abs(x)/.902
        # The alloy valance folds back towards the outer vents below its brow.
        fold=min(1,max(0,(abs(x)-.32)/.32))
        rows.append([(x*scale,y+tip*q*q,TAIL+inset+.025*q*q+
                      (fold*.082 if material==paint and y<.60 else 0)) for scale,y,tip,inset in levels])
    return surface_grid(name,rows,material)
tail_plane('Tail lamp bezel',[(1,.798,0,-.006),(1,.759,-.003,-.015),(.986,.719,-.006,-.006)],carbon)
tail_plane('Continuous tail blade',[(.992,.767,0,-.017),(.992,.751,-.001,-.018)],brake)
tail_plane('Folded rear valance',[(.984,.718,-.006,-.008),(.983,.690,-.005,-.018),(.98,.557,-.012,.026),(.96,.537,.002,.056)],paint)
box('Plate holder',(0,.609,-2.169),(.311,.142,.022),graphite,.008,(-.20,0,0))
box('Plate blank',(0,.611,-2.183),(.284,.124,.008),titanium,.005,(-.20,0,0))
for sign in (-1,1):
    tube('Rear reflector',[side_point(z,y,sign,.005) for z,y in ((-1.77,.588),(-1.83,.611))],.006,brake)
    # Wrap the black band into the rear quarters at rocker height.
    # The fixed quarter extends up to the diagonal leading edge of the
    # white endplate. Only the pocket aft of this joint opens with the wing.
    quarter=[]
    for z,drop in ((-1.799,.005),(-1.805,.007),(-1.86,.099),(-1.915,.190),(-1.94,.203)):
        sill=rail(z)[3][1]
        top=max(sill+.001,rail(z)[4][1]-drop)
        quarter.append([side_point(z,y,sign,.002) for y in (sill,top)])
    surface_grid('Quarter panel below airfoil',quarter,paint)
    for k in range(4):
        x=sign*(.712+k*.036)
        box('Outer diffuser louvre',(x,.430,-2.157),(.012,.083,.022),graphite,.002)

# A continuous open shroud with chamfered shoulders frames the four fan ducts.
# The ducts and nozzle mouths stand clear of the forward-recessed backing.
duct_x=(-.399,-.133,.133,.399)
outline=[(-.635,.210),(-.635,.458),(-.585,.494),(-.486,.522),(.486,.522),(.585,.494),
         (.635,.458),(.635,.210),(.590,.155),(.46,.144),(-.46,.144),(-.590,.155)]
shroud=[]
for z,scale in ((-2.024,.95),(-2.177,1),(-2.190,.982),(-2.178,.938),(-2.029,.925)):
    shroud.append([(x*scale,.33+(y-.33)*scale,z) for x,y in outline])
surface_grid('Rolled diffuser surround',[r+[r[0]] for r in shroud],carbon,True)
# Open one common cavity through the body cap; construct the duct interiors
# explicitly instead of leaving capped cylinders in the mouths of the fans.
cutter=box('Tail recess tool',(0,.332,-2.147),(1.239,.365,.30),carbon,0)
subtract(shell,cutter,'Rear fan cavity')
box('Diffuser back panel',(0,.333,-2.005),(1.245,.365,.018),throat,.015)
box('Nozzle rail',(0,.405,-2.137),(1.21,.013,.084),graphite,.003)
for x in (-.54,-.266,0,.266,.54):
    box('Fan partitions',(x,.279,-2.092),(.014,.21,.165),carbon,.006)
for x in duct_x:
    cylinder('Fan duct',(x,.289,-2.083),.105,.119,carbon,(0,0,1),32,0,caps=False)
    for k in range(9):
        a=k*math.tau/9
        profile=[(.027,-.14,-2.139),(.088,.08,-2.128),(.101,.22,-2.101),(.084,.52,-2.094),(.029,.48,-2.121)]
        mesh('Fan impeller',[(x+math.cos(a+t)*r,.289+math.sin(a+t)*r,z) for r,t,z in profile],[(0,1,2,3,4)],graphite)
    cylinder('Fan hub',(x,.289,-2.138),.030,.024,graphite,(0,0,1),24,.004)
    cylinder('Nozzle socket',(x,.455,-2.101),.067,.086,carbon,(0,0,1),32,0,caps=False)

# A body-colour airfoil completes the final 36 cm of the deck when parked.
# Its wrap-down tips reproduce the slashed rear quarters in the side view.
# Two telescoping posts ride on the carriage while the blade pitches on top.
WING_Y,WING_Z=.844,-1.92
carriage=empty('Wing_Carriage',(0,WING_Y,WING_Z),body)
carriage['restHeight']=carriage.location.z
carriage['travel']=.195
wing=empty('Rear_Wing',parent=carriage)
wing['brakeAngle']=.95
parent=carriage
for sign in (-1,1):
    loft('Telescoping wing post',[[(sign*.438+dx,y,z+dz) for dx,dz in ((-.013,-.026),(.013,-.026),(.013,.029),(-.013,.029))]
         for y,z in ((-.245,.064),(-.105,.050),(-.025,0),(-.003,0))],carbon,.002)
parent=wing
wing_rows=[]
for z in (WING_FRONT-.004,-1.88,-2.01,-2.159):
    r=rail(z)
    row=[]
    for x,y,_ in r[4:]:
        row.append((x,y-WING_Y,z-WING_Z))
    wing_rows.append([(-x,y,a) for x,y,a in row[:-1]]+row[::-1])
surface_grid('Flush deck airfoil',wing_rows,paint,True)
bottom=[[(x,y-.018,z) for x,y,z in line] for line in wing_rows]
surface_grid('Airfoil underside',bottom,carbon,True)
for edge in (0,-1):
    surface_grid('Airfoil edge return',[wing_rows[edge],bottom[edge]],carbon)
for s in (-1,1):
    tip=[]
    for z,drop in ((-1.805,.005),(-1.915,.187),(-2.048,.156),(-2.157,.100)):
        x,y,_=rail(z)[4]
        lower_x=side_point(z,y-drop,s,.004)[0]
        tip.append([(s*x,y-WING_Y,z-WING_Z),(lower_x,y-WING_Y-drop,z-WING_Z),
                    (lower_x-s*.006,y-WING_Y-drop,z-WING_Z)])
    surface_grid('Wing quarter endplate',tip,paint,True)
tube('Wing centre stop lamp',[(x,-.035,-.241) for x in (-.31,0,.31)],.0048,brake)
parent=body

# ---- Ten cold-gas thrusters retain the established names and plume axes:
# compact titanium nozzles in the diffuser, at the corners and on the flanks.
def thruster(name,mouth,direction,scale=1):
    d=Vector(direction).normalized(); bell=.13*scale; start=Vector(mouth)-d*bell
    tangent=d.cross(Vector((0,1,0)) if abs(d.y)<.9 else Vector((1,0,0))).normalized()
    bitangent=d.cross(tangent).normalized()
    profile=[(0,.030),(.25,.032),(.50,.042),(.75,.058),(1,.070),(1,.064),(.75,.052),(.50,.036),(.25,.026),(0,.024)]
    verts=[];n=24
    for t,r in profile:
        for i in range(n):
            a=i*math.tau/n
            verts.append(tuple(start+d*(t*bell)+(tangent*math.cos(a)+bitangent*math.sin(a))*(r*scale)))
    mesh(name+' bell lining',verts,[(j*n+i,j*n+(i+1)%n,((j+1)%len(profile))*n+(i+1)%n,((j+1)%len(profile))*n+i) for j in range(len(profile)) for i in range(n)],graphite,0,True)
    rim = [tuple(Vector(mouth)+(tangent*math.cos(a)+bitangent*math.sin(a))*(.067*scale))
           for a in [i*math.tau/32 for i in range(33)]]
    tube(name+' rolled exit rim',rim,.0022,titanium if name.startswith('Rear') else graphite)
    cylinder(name+' throat back',tuple(start+d*.005),.029*scale,.008,throat,tuple(d),32,0)
    # An annular/open flange: a capped cylinder would plug the throat with a
    # silver disk and make the nozzle read as a solid button from behind.
    cylinder(name+' mounting flange',tuple(start),.047*scale,.015,titanium,tuple(d),24,.002,caps=False)
    e=empty('Exhaust_'+name.replace(' ','_'),tuple(mouth),body)
    e['thrust']=list(d); e['exitRadius']=.07*scale
for i,x in enumerate(duct_x):
    thruster(f'Rear {i+1}',(x,.455,-2.191),(0,0,-1),.68)
for label,x,z in [('Lift FL',-.754,1.84),('Lift FR',.754,1.84),('Lift RL',-.79,-1.84),('Lift RR',.79,-1.84)]:
    # Fair the corner jets into the rising undertray. Their mouths meet the
    # bottom of the fairing, with no exposed brackets below the silhouette.
    sections=[]
    for y,rx,rz in ((.285,.105,.14),(.158,.087,.113),(.109,.073,.090),(.109,.057,.057),(.139,.054,.054)):
        sections.append([(x+rx*math.cos(a),y,z+rz*math.sin(a)) for a in [k*math.tau/32 for k in range(33)]])
    surface_grid(label+' undertray fairing',sections,carbon,True)
    thruster(label,(x,.109,z),(0,-1,0),.79)
for label,s in [('Yaw L',-1),('Yaw R',1)]:
    # The lateral jet sits within a dark flush aperture behind the front tyre.
    cylinder(label+' bezel',(s*.978,.216,.943),.052,.015,carbon,(1,0,0),32,.001,caps=False)
    thruster(label,(s*.983,.216,.943),(s,0,0),.64)

# ---- Aero wheel faces, six forged spokes, brake discs and tread lines.
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
    def ring(name,x,r,t,material,segments=48):
        bpy.ops.mesh.primitive_torus_add(major_segments=segments,minor_segments=4,major_radius=r,minor_radius=t,location=p((x,0,0)))
        o=bpy.context.object; o.rotation_euler=p((1,0,0)).to_track_quat('Z','Y').to_euler();finish(o,prefix+' '+name,material)
    ring('sidewall bead',outward*w*.499,R-.039,.003,rubber)
    cylinder(prefix+' rim barrel',(0,0,0),rim,w*.89,graphite,vertices=64,bevel=0,caps=False)
    outer=R*.862
    ring('aero rim lip',outward*w*.467,outer,.006,graphite,64)
    cylinder(prefix+' aero hoop',(outward*w*.433,0,0),outer,.041,graphite,vertices=64,bevel=0,caps=False)
    cylinder(prefix+' brake rotor',(outward*w*.11,0,0),rim*.80,.016,titanium,vertices=48,bevel=0)
    # Dark drillings break up the solid disc: flat hexagons on its face.
    for row in range(2):
        for k in range(24):
            a=(k+row*.4)*math.tau/24; r=rim*(.59+row*.13)
            mesh(prefix+' rotor drilling',[(outward*(w*.11+.0085),math.cos(a)*r+math.cos(b)*.0045,math.sin(a)*r+math.sin(b)*.0045) for b in [i*math.tau/6 for i in range(6)]],[tuple(range(6))],graphite)
    cylinder(prefix+' brake hat',(outward*w*.14,0,0),rim*.34,.020,graphite,vertices=48,bevel=.002)
    for k in range(8):
        a=k*math.tau/8
        cylinder(prefix+' rotor bolt',(outward*w*.185,math.cos(a)*rim*.29,math.sin(a)*rim*.29),.007,.008,titanium,vertices=8,bevel=0)
    # Six light alloy aero sectors sit behind the six dark, dished spokes.
    # The small gaps lead through to the hardware; the outer edge follows
    # the rim while the inner edge wraps around the black centre cap.
    for k in range(6):
        a=k*math.tau/6
        def radial(radius, angle, depth):
            return (outward*depth,math.cos(a+angle)*radius,math.sin(a+angle)*radius)
        sector=[]
        for step in range(8):
            t=step/7
            sector.append([radial(r,lerp(lo,hi,t),w*depth) for r,lo,hi,depth in (
                (.062,.39,.71,.425), (outer*.64,.193,.855,.414), (outer-.006,.114,.94,.448))])
        surface_grid(prefix+' aero sector',sector,titanium,True)
        # A raised spine and two chamfered faces give the blade a tapered
        # cross-section with a break in direction at the outer shoulder.
        spoke=[]
        for r,half,depth,sweep in ((.040,.38,.46,0),(.085,.239,.48,.020),
                                   (outer*.68,.124,.47,.056),(outer-.002,.111,.464,0)):
            spoke.append([radial(r,sweep+half*u,w*(depth+offset)) for u,offset in
                          ((-1,-.046),(-.78,0),(-.15,.010),(.82,-.007),(1,-.042))])
        surface_grid(prefix+' forged aero spoke',spoke,graphite)
    for k in range(5):
        a=k*math.tau/5
        cylinder(prefix+' wheel bolt',(outward*w*.50,math.cos(a)*.031,math.sin(a)*.031),.005,.007,titanium,vertices=8,bevel=0)
    cylinder(prefix+' centre lock',(outward*w*.48,0,0),.042,.024,graphite,vertices=20,bevel=.003)
    cylinder(prefix+' centre pin',(outward*w*.515,0,0),.015,.008,graphite,vertices=12,bevel=0)

for side,label in [(-1,'L'),(1,'R')]:
    for z,end,spec in [(FRONT_AXLE,'F',FRONT),(REAR_AXLE,'R',REAR)]:
        pivot=empty('Wheel_'+end+label,(side*spec['x'],spec['radius'],z),root)
        spinner=empty('Spinner_'+end+label,parent=pivot)
        parent=spinner; wheel(end+label,spec,side)
        parent=pivot
        box(end+label+' fixed caliper',(side*spec['width']*.20,.04,-spec['rim']*.62),(.045,.13,.072),caliper,.012)
parent=body

# Two long strip lights describe the shoulder and the crown separately. The
# cameras and studio live outside the vehicle hierarchy used by the exporter.
scene=bpy.context.scene
scene.unit_settings.system='METRIC'
scene.world.use_nodes=True
sky=scene.world.node_tree.nodes['Background']
sky.inputs[0].default_value=(.24,.26,.30,1)
sky.inputs[1].default_value=.32
scene.render.engine='CYCLES'
scene.cycles.samples=32
scene.cycles.use_denoising=True
scene.render.resolution_x=1600
scene.render.resolution_y=900
scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
bpy.context.preferences.filepaths.save_version=0
source_parts=sum(o.type in {'MESH','CURVE','FONT'} for o in root.children_recursive)
parent=None
studio_mat=mat('Studio',(.027,.033,.045),.12,.49)
box('Studio floor',(0,-.055,0),(32,.1,32),studio_mat,0)
cyclorama=[]
for step in range(21):
    angle=(math.pi/2)*step/20
    radius=10+4*math.sin(angle)
    height=-.006+4*(1-math.cos(angle))
    cyclorama.append([(radius*math.cos(t),height,radius*math.sin(t)) for t in [k*math.tau/128 for k in range(129)]])
cyclorama.append([(x,14,z) for x,y,z in cyclorama[-1]])
surface_grid('Seamless studio cove',cyclorama,studio_mat,True)
def softbox(name,loc,power,size,width,target,color):
    light=bpy.data.lights.new(name,'AREA')
    light.energy=power
    light.shape='RECTANGLE'
    light.size=size
    light.size_y=width
    light.color=color
    obj=bpy.data.objects.new(name,light)
    scene.collection.objects.link(obj)
    obj.location=p(loc)
    obj.rotation_euler=(p(target)-obj.location).to_track_quat('-Z','Y').to_euler()
softbox('Overhead silk',(-4.3,4.0,2.3),625,5.8,1.8,(0,.5,0),(1,.91,.82))
softbox('Shoulder strip',(3.5,1.8,-1.5),185,5,.72,(0,.7,0),(.81,.88,1))
softbox('Nose fill',(1.7,1.8,5.4),170,3,2.5,(0,.38,1),(1,.94,.88))
softbox('Backlight',(-3.0,2.4,-4.5),340,3.5,.95,(0,.55,-.6),(.81,.87,1))
softbox('Tail fill',(2.0,1.2,-4.1),70,2.0,1.3,(0,.38,-1.8),(1,.86,.74))

def camera(name,loc,target,lens):
    data=bpy.data.cameras.new(name)
    obj=bpy.data.objects.new(name,data)
    scene.collection.objects.link(obj)
    obj.location=p(loc)
    obj.rotation_euler=(p(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    data.lens=lens
    return obj
front_camera=camera('Front three-quarter',(5.15,1.67,7.65),(0,.51,.02),70)
rear_camera=camera('Rear three-quarter',(5.75,1.76,-8.10),(0,.54,-.17),69)
front_camera.data.shift_x=-.044
rear_camera.data.shift_x=.050
scene.camera=front_camera
studio=bpy.data.collections.new('Photography')
scene.collection.children.link(studio)
for obj in [o for o in scene.objects if o.parent is None and o != root]:
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    studio.objects.link(obj)
bpy.ops.object.select_all(action='DESELECT')
root.select_set(True)
bpy.context.view_layer.objects.active=root
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            view=area.spaces.active
            view.region_3d.view_distance=5.8
            view.region_3d.view_location=p((0,.52,0))
            view.region_3d.view_rotation=front_camera.rotation_euler.to_quaternion()
            view.shading.type='MATERIAL'
            view.overlay.show_overlays=False
scene.render.filepath='//roadster-front-preview.png'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'roadster-rocket.blend'),compress=True)
bpy.ops.render.render(write_still=True)
# The rear photograph shows the extended wing above the diffuser. Reset the
# carriage after rendering so the game and the editable scene both open parked.
carriage.location.z += carriage['travel']
wing.rotation_euler.x=.095
scene.camera=rear_camera
scene.render.filepath=str(OUT/'roadster-preview.png')
bpy.ops.render.render(write_still=True)
wing.rotation_euler.x=0
carriage.location.z=WING_Y
bpy.context.view_layer.update()
import sys
sys.path.insert(0,str(ROOT/'scripts'))
from export_roadster import export_roadster
export_roadster(root,OUT,source_parts)
