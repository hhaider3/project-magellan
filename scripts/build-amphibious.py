"""Author ATLAS's reversible car-to-boat and car-to-plane transformations.

Blender --background --python scripts/build-amphibious.py
Reuses the editable expedition car, preserving its original source asset.
Transform_To_Boat, frames 1–121: unlatch, spread the body halves, slide the
wheels out and stow them flat in the hull wells, deploy planing hulls, extend
the bow fairing and jets.
Transform_To_Plane, frames 1–81: telescope tapered wings out of the body sides
and fold their winglets up, extend twin tail booms that raise fins and slide
the tailplane's halves together, and push a folding propeller out through the
grille. The wheels stay down as landing gear.
Each transformation is its own NLA track, exported as its own glTF clip.
"""
import bpy, bmesh, math, json
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'vehicles'
bpy.ops.wm.open_mainfile(filepath=str(OUT / 'atlas-expedition.blend'))
root = bpy.data.objects['Atlas_Expedition']
body = bpy.data.objects['Body']
scene = bpy.context.scene
scene.name = 'Transform_To_Boat'
scene.render.fps = 50
scene.frame_start = 1; scene.frame_end = 121
bpy.context.preferences.filepaths.save_version = 0

def p(v): return Vector((v[0], -v[2], v[1]))
def game(v): return (v.x, v.z, -v.y)
def group(name, loc=(0,0,0), parent=body):
    o=bpy.data.objects.new(name,None); scene.collection.objects.link(o)
    o.parent=parent; o.location=p(loc); return o
def adopt(o, parent):
    matrix=o.matrix_world.copy(); o.parent=parent; o.matrix_world=matrix
def centre(o):
    return sum((o.matrix_world @ Vector(corner) for corner in o.bound_box),Vector())/8
def finish(o, name, parent, mat, bevel=.025):
    o.name=name; o.data.materials.append(bpy.data.materials[mat])
    if bevel:
        mod=o.modifiers.new('Panel edge','BEVEL'); mod.width=bevel; mod.segments=2
        mod=o.modifiers.new('Panel normals','WEIGHTED_NORMAL'); mod.keep_sharp=True
    bpy.context.view_layer.update(); adopt(o,parent); return o
def box(name, loc, size, parent, mat='Graphite', bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1,location=p(loc)); o=bpy.context.object
    o.dimensions=(size[0],size[2],size[1]); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,name,parent,mat,bevel)
def mesh(name, verts, faces, parent, mat='Paint_Copper'):
    data=bpy.data.meshes.new(name); data.from_pydata([p(v) for v in verts],[],faces); data.update()
    bm=bmesh.new(); bm.from_mesh(data); bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(data); bm.free()
    o=bpy.data.objects.new(name,data); scene.collection.objects.link(o)
    return finish(o,name,parent,mat)
def beam(name,a,b,r,parent,mat='Brushed_Alloy'):
    start,end=p(a),p(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=r,depth=(end-start).length,location=(start+end)/2)
    o=bpy.context.object; o.rotation_euler=(end-start).to_track_quat('Z','Y').to_euler()
    return finish(o,name,parent,mat,.008)
def ring(name,loc,r,parent,mat='Brushed_Alloy'):
    bpy.ops.mesh.primitive_torus_add(major_segments=32,minor_segments=8,major_radius=r,minor_radius=.045,location=p(loc))
    o=bpy.context.object; o.rotation_euler=(math.pi/2,0,0)
    return finish(o,name,parent,mat,0)
def animate(o, poses):
    base=o.location.copy()
    for frame,translation,rotation,scale in poses:
        o.location=base+p(translation)
        # Game Euler X/Y/Z map to Blender X/Z/-Y.
        o.rotation_euler=(rotation[0],-rotation[2],rotation[1])
        o.scale=scale
        for key in ('location','rotation_euler','scale'): o.keyframe_insert(data_path=key,frame=frame)
    o['transformPart']=True
    scene.frame_set(1)
def push(o, track):
    # One NLA track per transformation; the exporter writes each as a clip.
    data=o.animation_data; action=data.action; action.name=o.name+'|'+track
    nla=data.nla_tracks.new(); nla.name=track
    nla.strips.new(track,1,action); data.action=None
    o['clip']=track
    scene.frame_set(1)
def group_at(name, loc, parent):
    # An empty at a world position (game coordinates), parented without moving.
    o=bpy.data.objects.new(name,None); scene.collection.objects.link(o)
    o.location=p(loc); bpy.context.view_layer.update(); adopt(o,parent); return o
def loft(name, rings, parent, mat, caps=True):
    # Closed surface through same-sized cross-section rings (game coordinates).
    n=len(rings[0]); verts=[v for ring in rings for v in ring]; faces=[]
    for j in range(len(rings)-1):
        for k in range(n): faces.append((j*n+k,j*n+(k+1)%n,(j+1)*n+(k+1)%n,(j+1)*n+k))
    if caps: faces+= [tuple(range(n))[::-1], tuple((len(rings)-1)*n+k for k in range(n))]
    return mesh(name,verts,faces,parent,mat)
def material(name, color, emission=None, strength=0):
    m=bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes=True; bsdf=m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value=(*color,1); bsdf.inputs['Roughness'].default_value=.35
    if emission:
        bsdf.inputs['Emission Color'].default_value=(*emission,1); bsdf.inputs['Emission Strength'].default_value=strength
    return m

left=group('Hull_L',(-.85,.75,0)); right=group('Hull_R',(.85,.75,0))
bow=group('Bow_Extension',(0,1.2,1.1)); stern=group('Stern_Deck',(0,.7,-1.8))
cabin=group('Cabin_Slide',(0,1.5,-.6))
bpy.context.view_layer.update()

# Split the car's actual pressed body shell into independently moving halves.
shell=bpy.data.objects['Pressed aluminium body']
for sign,parent in [(-1,left),(1,right)]:
    o=shell.copy(); o.data=shell.data.copy(); scene.collection.objects.link(o)
    o.name='Split body port' if sign<0 else 'Split body starboard'
    bm=bmesh.new(); bm.from_mesh(o.data)
    cut=bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,
        plane_co=(0,0,0),plane_no=(1,0,0),clear_inner=sign>0,clear_outer=sign<0)
    edges=[e for e in cut['geom_cut'] if isinstance(e,bmesh.types.BMEdge) and e.is_boundary]
    if edges: bmesh.ops.holes_fill(bm,edges=edges,sides=0)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(o.data); bm.free()
    bpy.context.view_layer.update(); adopt(o,parent)
bpy.data.objects.remove(shell,do_unlink=True)

side_parts=('Satin arch flare','Fender fastener','Flexible mud flap','Rock slider','Step tread','Step grip',
    'Side protection strip','Ivory coach stripe','Front marker','Fender cooling slot','Door shut line','Handle recess','Door handle')
front_parts=('Bonnet','Grille','Recessed radiator','Headlamp','Lens fluting','Front signal','Front bumper','Front skid','Skid plate','Winch','Recovery shackle')
cabin_parts=('Cabin frame','Floating roof','Panoramic windshield','Rear glass','Front door glass','Rear quarter glass','B pillar','Beltline',
    'Mirror','Wiper','Rack foot','Roof basket','Basket','Expedition hard case','Case','Strap','Canvas bedroll','Bedroll','Auxiliary')
for o in list(body.children):
    if o.type not in {'MESH','CURVE','FONT'}: continue
    if o.name.startswith(side_parts): adopt(o,left if centre(o).x<0 else right)
    elif o.name.startswith(front_parts): adopt(o,bow)
    elif o.name.startswith(cabin_parts): adopt(o,cabin)
    elif o.name.startswith(('Rear bumper','Rear number','Registration','Tow receiver','Exhaust')): adopt(o,stern)

# Planing hulls are packed inside the car's side sills. They grow out of the
# sills and move with the body halves into a wide, stable catamaran stance.
def hull_ring(hw, chw, keel, chine, gun):
    return [(-hw,gun),(-chw,chine),(0,keel),(chw,chine),(hw,gun),(0,gun+.03)]
HULL=[(-2.78,.58,.50,-.40,-.30,.20),(-2.2,.62,.54,-.50,-.34,.20),(1.2,.62,.54,-.52,-.36,.20),
      (1.9,.58,.46,-.42,-.26,.24),(2.4,.40,.28,-.16,-.02,.32),(2.77,.05,.03,.18,.22,.42)]
for sign,label,parent in [(-1,'L',left),(1,'R',right)]:
    base=Vector((sign*.8,.72,0))
    pod=group_at('Pontoon_'+label,tuple(base),parent)
    rings=[[(base.x+u,base.y+v,base.z+w) for u,v in hull_ring(hw,chw,keel,chine,gun)] for w,hw,chw,keel,chine,gun in HULL]
    loft('Copper planing hull '+label,rings,pod,'Paint_Copper')
    # Graphite rub rails along both gunwales, and deck grips between the wells.
    for side in (-1,1):
        beam('Rub rail '+label,(base.x+side*.6,base.y+.17,base.z-2.7),(base.x+side*.59,base.y+.19,base.z+1.9),.035,pod,'Graphite')
    for zz in (-.6,-.25,.1,.45):
        box('Deck grip '+label,(base.x,base.y+.235,base.z+zz),(.8,.014,.05),pod,'Brushed_Alloy',.003)
    # Dark wells receive the folded wheels (wheel centres sit at z = ±1.37).
    for zz in (1.37-.18,-1.37-.18):
        bpy.ops.mesh.primitive_torus_add(major_segments=32,minor_segments=6,major_radius=.6,minor_radius=.035,location=p((base.x,base.y+.215,base.z+zz)))
        finish(bpy.context.object,'Wheel well rim '+label,pod,'Graphite',0)
    animate(pod,[(1,(0,0,0),(0,0,0),(.35,.2,.28)),(16,(0,0,0),(0,0,0),(.35,.2,.28)),
        (60,(sign*.2,-.10,.1),(0,0,0),(1,1,1)),(121,(sign*.2,-.10,.1),(0,0,0),(1,1,1))])
    push(pod,'Transform_To_Boat')
    for zz in (-1.15,1.15): beam('Hull hydraulic ram '+label,(sign*.38,.68,zz),(sign*1.27,.7,zz),.05,parent)
    animate(parent,[(1,(0,0,0),(0,0,0),(1,1,1)),(22,(sign*.08,.025,0),(0,0,0),(1,1,1)),
        (60,(sign*.58,-.16,.08),(0,0,0),(1,1,1)),(121,(sign*.58,-.16,.08),(0,0,0),(1,1,1))])

# Each wheel slides straight out of its arch, turns flat in free space beside
# the car, then sinks into its hull well. Nothing passes through the body.
for name in ('FL','RL','FR','RR'):
    wheel=bpy.data.objects['Wheel_'+name]; sign=-1 if name.endswith('L') else 1
    fold=group('WheelFold_'+name,parent=root)
    bpy.context.view_layer.update(); adopt(wheel,fold)
    centre_at=wheel.location.copy(); fold.location=centre_at; wheel.location=(0,0,0)
    flat=(0,0,-sign*math.pi/2)
    animate(fold,[(1,(0,0,0),(0,0,0),(1,1,1)),(12,(sign*.12,.04,0),(0,0,0),(1,1,1)),
        (34,(sign*1.15,.40,0),(0,0,0),(1,1,1)),(56,(sign*1.15,.40,0),flat,(1,1,1)),
        (72,(sign*1.15,-.07,0),flat,(1,1,1)),(92,(sign*.54,-.07,0),flat,(1,1,1)),(121,(sign*.54,-.07,0),flat,(1,1,1))])
    push(fold,'Transform_To_Boat')

# A single raked bow fairing slides forward from beneath the front skid and
# closes the gap between the two hull bows; the bumper rides on top of it.
keel=group_at('Keel_Deploy',(0,.42,1.6),body)
BOW=[(0,.95,.72,-.40,-.15,.10),(1.0,.70,.50,-.22,-.02,.11),(1.7,.38,.26,0,.08,.14),(2.2,.06,.04,.18,.20,.24),(2.3,.01,.01,.22,.22,.25)]
rings=[[(u,.42+v,1.6+w) for u,v in hull_ring(hw,chw,keel_y,chine,gun)] for w,hw,chw,keel_y,chine,gun in BOW]
loft('Raked bow fairing',rings,keel,'Paint_Copper')
beam('Bow stem',(0,.42-.40,1.6),(0,.42+.22,1.6+2.3),.03,keel,'Brushed_Alloy')
animate(keel,[(1,(0,0,0),(0,0,0),(.5,.15,.2)),(24,(0,0,0),(0,0,0),(.5,.15,.2)),
    (95,(0,0,.35),(0,0,0),(1,1,1)),(121,(0,0,.35),(0,0,0),(1,1,1))])
push(keel,'Transform_To_Boat')
bridge=group('Bridge_Deck',(0,.8,.3)); bpy.context.view_layer.update()
box('Telescoping sealed bridge',(0,1.23,1.05),(1.5,.12,2.3),bridge)
for zz in (.45,.7,.95,1.2,1.45,1.7): box('Bridge cooling fin',(0,1.297,zz),(1.22,.016,.032),bridge,'Brushed_Alloy',.003)
for sign in (-1,1): beam('Bow extension rail',(sign*.69,1.31,0),(sign*.69,1.31,2.16),.045,bridge)
animate(bridge,[(1,(0,0,0),(0,0,0),(1,.12,.18)),(25,(0,0,0),(0,0,0),(1,.12,.18)),
    (95,(0,0,0),(0,0,0),(1,1,1)),(121,(0,0,0),(0,0,0),(1,1,1))])
push(bridge,'Transform_To_Boat')
animate(bow,[(1,(0,0,0),(0,0,0),(1,1,1)),(25,(0,.12,.1),(-.04,0,0),(1,1,1)),
    (90,(0,-.02,.84),(-.04,0,0),(1.16,1,1.08)),(121,(0,-.02,.84),(-.04,0,0),(1.16,1,1.08))])
push(bow,'Transform_To_Boat')
animate(cabin,[(1,(0,0,0),(0,0,0),(1,1,1)),(34,(0,.08,-.05),(0,0,0),(1,1,1)),
    (95,(0,-.14,-.25),(0,0,0),(1,1,.96)),(121,(0,-.14,-.25),(0,0,0),(1,1,.96))])
push(cabin,'Transform_To_Boat')
animate(stern,[(1,(0,0,0),(0,0,0),(1,1,1)),(55,(0,0,0),(0,0,0),(1,1,1)),
    (108,(0,.02,-.6),(0,0,0),(1.4,1,1)),(121,(0,.02,-.6),(0,0,0),(1.4,1,1))])
push(stern,'Transform_To_Boat')
for sign,label in [(-1,'L'),(1,'R')]:
    jet=group('Jet_'+label,(sign*.59,.48,-1.85)); bpy.context.view_layer.update()
    ring('Water jet nozzle '+label,(sign*.59,.48,-1.85),.23,jet)
    box('Jet housing '+label,(sign*.59,.48,-1.67),(.53,.5,.42),jet)
    for angle in (0,math.pi/3,2*math.pi/3):
        a=(sign*.59+math.cos(angle)*.2,.48+math.sin(angle)*.2,-1.88)
        b=(sign*.59-math.cos(angle)*.2,.48-math.sin(angle)*.2,-1.88)
        beam('Jet rotor '+label,a,b,.018,jet)
    animate(jet,[(1,(0,0,0),(0,0,0),(.08,.08,.08)),(65,(0,0,0),(0,0,0),(.08,.08,.08)),
        (112,(sign*.16,-.03,-.8),(0,0,0),(1,1,1)),(121,(sign*.16,-.03,-.8),(0,0,0),(1,1,1))])
    push(jet,'Transform_To_Boat')
for o in (left,right): push(o,'Transform_To_Boat')

# ---- Transform_To_Plane: frames 1–81 (1.6 s). Every part is stowed inside the
# body at frame 1, so the car keeps its exact silhouette until it transforms.
# Parts are modelled where they sit in flight, then slid back to their stowed
# places: the clip runs from there back out to here.
nav_red=material('Nav_Red',(.55,.05,.04),(1,.08,.05),6)
nav_green=material('Nav_Green',(.05,.45,.15),(.1,1,.35),6)
nav_white=material('Nav_White',(.8,.8,.76),(1,1,.94),5)
def thickness(u,t): return 5*t*(.2969*math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1036*u**4)
def camber(u,m,p=.4): return 0 if not m else m/p/p*(2*p*u-u*u) if u<p else m/(1-p)**2*(1-2*p+2*p*u-u*u)
def section(t, m=0, n=12, start=0, end=1):
    # A closed NACA four-digit section, as (u, v) in chords: u back from the
    # leading edge, v up. Whole, it ends in a sharp trailing edge; cut at
    # `end` it ends square (the wing ahead of a flap), and started at `start`
    # it gets a rounded nose (the flap, aileron, rudder or elevator itself).
    us=[start+(end-start)*(1-math.cos(math.pi*i/n))/2 for i in range(n+1)]
    top=[(u,camber(u,m)+thickness(u,t)) for u in reversed(us)]
    bottom=[(u,camber(u,m)-thickness(u,t)) for u in us]
    ring=top+[(start-thickness(start,t)*.8,camber(start,m))]+bottom if start else top+bottom[1:]
    return ring[:-1] if end>=1 else ring
def place(sec, at, chord, forward, up):
    # A section in the model: `at` is its 40% chord point, `forward` points from
    # the trailing edge to the leading edge, `up` across the section.
    at,forward,up=Vector(at),Vector(forward),Vector(up)
    return [tuple(at+forward*(.4-u)*chord+up*v*chord) for u,v in sec]
def skin(name, rings, parent, mat, sharp=80):
    # Like loft, but smooth shaded and unbevelled: an edge stays crisp only
    # where its faces meet at more than `sharp` degrees (trailing edges, caps).
    n=len(rings[0]); verts=[v for ring in rings for v in ring]; faces=[]
    for j in range(len(rings)-1):
        for k in range(n): faces.append((j*n+k,j*n+(k+1)%n,(j+1)*n+(k+1)%n,(j+1)*n+k))
    faces+=[tuple(range(n))[::-1],tuple((len(rings)-1)*n+k for k in range(n))]
    data=bpy.data.meshes.new(name); data.from_pydata([p(v) for v in verts],[],faces); data.update()
    bm=bmesh.new(); bm.from_mesh(data); bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    for f in bm.faces: f.smooth=True
    for e in bm.edges: e.smooth=e.is_manifold and e.calc_face_angle(0)<math.radians(sharp)
    bm.to_mesh(data); bm.free()
    o=bpy.data.objects.new(name,data); scene.collection.objects.link(o)
    return finish(o,name,parent,mat,0)
def lathe(name, at, axis, profile, parent, mat, sides=20):
    # A body of revolution: profile is [(distance along axis from at, radius)].
    at,axis=Vector(at),Vector(axis).normalized(); a=axis.orthogonal().normalized(); b=axis.cross(a)
    rings=[[tuple(at+axis*d+(a*math.cos(2*math.pi*k/sides)+b*math.sin(2*math.pi*k/sides))*r) for k in range(sides)] for d,r in profile]
    return skin(name,rings,parent,mat,50)
def surface(name, stations, parent, mat, t, m=0, hinge=.7, up=(0,1,0), sharp=80):
    # A tapered flying surface split at `hinge` into its fixed part and its
    # control surface. stations: [(40% chord point, chord)].
    fixed,moving=section(t,m,12,0,hinge),section(t,m,8,hinge+.02)
    skin(name,[place(fixed,at,c,(0,0,1),up) for at,c in stations],parent,mat,sharp)
    skin(name+' control',[place(moving,at,c,(0,0,1),up) for at,c in stations],parent,mat,sharp)

# The wings telescope out of slots in the doors: three nested, tapering panels
# with flaps and ailerons, at 4° of dihedral. The wingtips fold up last.
DIHEDRAL=math.radians(4)
def wing_at(sign, s):
    # The 40% chord point s metres out along the wing (the slot is at s = 1).
    return (sign*(1+(s-1)*math.cos(DIHEDRAL)),1.12+(s-1)*math.sin(DIHEDRAL),-.084-.05*(s-1))
def wing_axis(sign, d): return (sign*d*math.cos(DIHEDRAL),d*math.sin(DIHEDRAL),0)
# (inner, outer station; chords there; thickness/chord; slide out of the panel
# inside it; frames). Stowed, all three lie inside the body.
WING=[(.98,1.97,1.16,1.03,.13,.97,(4,28)),(1.87,2.86,.97,.83,.12,.89,(14,44)),(2.76,3.70,.78,.56,.11,1.22,(26,58))]
for sign,label in [(-1,'L'),(1,'R')]:
    parent=body; panels=[]
    for k,(s0,s1,c0,c1,t,slide,frames) in enumerate(WING):
        panel=group_at(f'WingSeg{k+1}_{label}',wing_at(sign,s0),parent)
        surface(f'Wing panel {k+1} {label}',[(wing_at(sign,s0),c0),(wing_at(sign,s1),c1)],panel,'Paint_Copper',t,.02)
        if k<2: # a graphite band where the next panel slides out
            band=section(t*1.04,.02,12)
            skin(f'Wing joint band {k+1} {label}',[place(band,wing_at(sign,s),c1*1.04,(0,0,1),(0,1,0)) for s in (s1-.035,s1)],panel,'Graphite')
        panels.append((panel,slide,frames)); parent=panel
    # The winglet: hinged on the tip, canted 12° out, swept back.
    tip=Vector(wing_at(sign,3.70)); cant=math.radians(12)
    rise,across=Vector((sign*math.sin(cant),math.cos(cant),0)),(sign*math.cos(cant),-math.sin(cant),0)
    winglet=group_at('WingTip_'+label,tuple(tip),panels[-1][0])
    lead=tip.z+.4*.56-.03
    skin('Winglet '+label,[place(section(.1*f),tip+rise*h+Vector((0,0,lead-.69*h-.4*c-tip.z)),c,(0,0,1),across)
        for h,c,f in ((0,.5,1),(.18,.38,1),(.33,.26,1),(.37,.14,.6))],winglet,'Roof_Ivory')
    light=tip+rise*.07+Vector((0,0,lead-.12-tip.z))+Vector(across)*.03
    box('Wingtip light '+label,tuple(light),(.03,.05,.12),winglet,'Nav_Red' if sign>0 else 'Nav_Green',.006)
    for panel,slide,(start,end) in panels:
        out=wing_axis(sign,slide)
        panel.location-=p(out)
        animate(panel,[(1,(0,0,0),(0,0,0),(1,1,1)),(start,(0,0,0),(0,0,0),(1,1,1)),(end,out,(0,0,0),(1,1,1)),(81,out,(0,0,0),(1,1,1))])
        push(panel,'Transform_To_Plane')
    # Stowed flat, the winglet continues the wing out through the slot.
    flat=(0,0,-sign*(math.pi/2-cant-DIHEDRAL))
    animate(winglet,[(1,(0,0,0),flat,(1,1,1)),(58,(0,0,0),flat,(1,1,1)),(74,(0,0,0),(0,0,0),(1,1,1)),(81,(0,0,0),(0,0,0),(1,1,1))])
    push(winglet,'Transform_To_Plane')
    # A graphite slot marks where each wing leaves the body side.
    box('Wing slot trim '+label,(sign*1.016,1.13,-.2),(.02,.19,1.22),left if sign<0 else right,'Graphite',.004)

# Twin tail booms telescope back from the body's rear corners, rising 3° so the
# tail clears the ground as the nose lifts. Out past the spare wheel, the fins
# rise out of them and the tailplane's halves slide in to meet in the middle:
# an H tail, every surface joined to a boom.
RISE=math.radians(3); AFT=Vector((0,math.sin(RISE),-math.cos(RISE)))
def boom_at(sign, a): return Vector((sign*.9,1.415,-2.0))+AFT*a
for sign,label in [(-1,'L'),(1,'R')]:
    root_at=boom_at(sign,0)
    # A graphite port on the body corner, which the boom's painted outer sleeve
    # slides through; the bare inner tube telescopes out of that.
    lathe('Tail boom port '+label,root_at,AFT,[(-.01,.078),(.012,.078)],body,'Graphite')
    b1=group_at('TailBoom1_'+label,tuple(root_at),body)
    lathe('Tail boom '+label,root_at,AFT,[(-.08,.066),(1.22,.066)],b1,'Paint_Copper')
    lathe('Tail boom joint '+label,root_at,AFT,[(1.16,.077),(1.24,.077)],b1,'Graphite')
    b2=group_at('TailBoom2_'+label,tuple(boom_at(sign,1.1)),b1)
    lathe('Tail boom tip '+label,root_at,AFT,[(1.1,.055),(2.3,.055),(2.45,.048),(2.56,.036),(2.63,.022),(2.68,.008)],b2,'Brushed_Alloy')
    # The fin stands on the boom: swept, tapering, with its rudder.
    fin=group_at('TailFin_'+label,tuple(boom_at(sign,2.2)),b2)
    foot,lead=boom_at(sign,2.2).y,boom_at(sign,1.78).z
    fin_at=lambda h,c: ((sign*.9,foot+h,lead-.4*h-.4*c),c)
    surface('Tail fin '+label,[fin_at(0,.86),fin_at(.45,.66),fin_at(.84,.46)],fin,'Paint_Copper',.09,hinge=.66,up=(1,0,0))
    # A low strake runs the fin's leading edge down onto the boom.
    skin('Fin strake '+label,[place(section(.1),(sign*.9,foot+h,lead+front-.4*c),c,(0,0,1),(1,0,0)) for h,front,c in ((0,.36,.62),(.17,-.06,.24))],fin,'Paint_Copper')
    skin('Fin cap '+label,[place(section(.09*f),*fin_at(h,c),(0,0,1),(1,0,0)) for h,c,f in ((.84,.46,1),(.89,.4,.85),(.915,.24,.5))],fin,'Roof_Ivory')
    box('Tail light '+label,(sign*.9,foot+.87,lead-.4*.87-.39),(.03,.04,.05),fin,'Nav_White',.006)
    # Half the tailplane, from this boom to the centre line, with its elevator.
    stab=group_at('Tail_Stabilizer_'+label,tuple(boom_at(sign,2.24)),b2)
    level,front=boom_at(sign,2.24).y,boom_at(sign,1.98).z
    surface('Tailplane '+label,[((x,level,front-.4*.64),.64) for x in (sign*.9,sign*.006)],stab,'Paint_Copper',.1,hinge=.68)
    for group,slide in ((b2,1.44),(b1,1.28)): group.location-=p(AFT*slide)
    animate(b1,[(1,(0,0,0),(0,0,0),(1,1,1)),(4,(0,0,0),(0,0,0),(1,1,1)),(32,AFT*1.28,(0,0,0),(1,1,1)),(81,AFT*1.28,(0,0,0),(1,1,1))])
    animate(b2,[(1,(0,0,0),(0,0,0),(1,1,1)),(16,(0,0,0),(0,0,0),(1,1,1)),(46,AFT*1.44,(0,0,0),(1,1,1)),(81,AFT*1.44,(0,0,0),(1,1,1))])
    # Blender scale axes: x across, z up.
    animate(fin,[(1,(0,0,0),(0,0,0),(1,1,.02)),(44,(0,0,0),(0,0,0),(1,1,.02)),(62,(0,0,0),(0,0,0),(1,1,1)),(81,(0,0,0),(0,0,0),(1,1,1))])
    animate(stab,[(1,(0,0,0),(0,0,0),(.02,1,1)),(52,(0,0,0),(0,0,0),(.02,1,1)),(70,(0,0,0),(0,0,0),(1,1,1)),(81,(0,0,0),(0,0,0),(1,1,1))])
    for o in (b1,b2,fin,stab): push(o,'Transform_To_Plane')

# A three-blade tractor propeller pushes out through the grille on its shaft.
# Its twisted blades lie folded forward over the spinner until it is clear of
# the bumper, then swing out. The game spins 'Propeller' itself.
HUB=Vector((0,.98,2.62)); PROP_SLIDE=1.45
hub=group_at('Prop_Hub',tuple(HUB),body)
lathe('Propeller spinner',HUB,(0,0,1),[(-.07,.16),(0,.162),(.06,.155),(.14,.13),(.21,.095),(.27,.055),(.31,.022),(.325,.004)],hub,'Brushed_Alloy',24)
lathe('Propeller shaft',HUB,(0,0,1),[(-1.6,.07),(-.18,.07),(-.1,.13),(-.07,.165),(-.05,.165)],hub,'Graphite',24)
spinner=group_at('Propeller',tuple(HUB),hub)
for k in range(3):
    theta=k*2*math.pi/3
    mount=bpy.data.objects.new(f'BladeMount_{k+1}',None); scene.collection.objects.link(mount)
    mount.matrix_world=Matrix.Translation(p(HUB))@Matrix.Rotation(theta,4,'Y'); adopt(mount,spinner)
    blade=group_at(f'BladeFold_{k+1}',tuple(HUB),mount)
    # The blade turns toward `along`; pitch tips its leading edge forward.
    out,along=Vector((math.sin(theta),math.cos(theta),0)),Vector((-math.cos(theta),math.sin(theta),0))
    def blade_ring(r,c,pitch):
        pitch=math.radians(pitch); forward=along*math.cos(pitch)+Vector((0,0,1))*math.sin(pitch)
        return place(section(.12,.04,7),HUB+out*r,c,forward,out.cross(forward))
    skin(f'Propeller blade {k+1}',[blade_ring(*s) for s in ((.1,.09,50),(.3,.135,36),(.5,.125,26),(.66,.1,20))],blade,'Graphite',120)
    skin(f'Propeller blade tip {k+1}',[blade_ring(*s) for s in ((.66,.1,20),(.74,.08,17),(.79,.04,15))],blade,'Roof_Ivory',120)
    animate(blade,[(1,(0,0,0),(1.4,0,0),(1,1,1)),(40,(0,0,0),(1.4,0,0),(1,1,1)),(64,(0,0,0),(0,0,0),(1,1,1)),(81,(0,0,0),(0,0,0),(1,1,1))])
    push(blade,'Transform_To_Plane')
hub.location-=p((0,0,PROP_SLIDE))
animate(hub,[(1,(0,0,0),(0,0,0),(1,1,1)),(4,(0,0,0),(0,0,0),(1,1,1)),(32,(0,0,PROP_SLIDE),(0,0,0),(1,1,1)),(81,(0,0,PROP_SLIDE),(0,0,0),(1,1,1))])
push(hub,'Transform_To_Plane')

root['asset']='ATLAS Amphibious / mechanically transforming expedition vehicle'
root['transformDuration']=2.4; root['flightDuration']=1.6
scene.timeline_markers.clear()
for name,frame in [('CAR',1),('UNLATCH',22),('HULLS SPREAD / WHEELS OUT',60),('WHEELS STOWED',92),('BOW EXTENDS',95),('BOAT / JETS LOCK',121)]: scene.timeline_markers.new(name,frame=frame)
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'atlas-amphibious.blend'))

# Preserve animated hierarchy; batch only geometry directly owned by each node.
groups=[o for o in [root,*root.children_recursive] if o.type=='EMPTY']
batching=[]
for parent in groups:
    parts=[o for o in list(parent.children) if o.type in {'MESH','CURVE','FONT'}]
    if not parts: continue
    buckets={}; parent['sourceParts']=len(parts)
    for o in parts:
        for mod in o.modifiers:
            if mod.type=='BEVEL': mod.segments=1 if max(o.dimensions)<.35 else 2
        bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active=o
        bpy.ops.object.convert(target='MESH'); o=bpy.context.object
        buckets.setdefault(o.data.materials[0].name,[]).append(o)
    for mat,objects in buckets.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects: o.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]; bpy.ops.object.join(); o=bpy.context.object
        o.name=parent.name+'__'+mat
        if mat!='Smoked_Glass' and len(o.data.polygons)>400:
            mod=o.modifiers.new('Game reduction','DECIMATE'); mod.ratio=.48; bpy.ops.object.modifier_apply(modifier=mod.name)
    batching.append({'group':parent.name,'before':len(parts),'after':len(buckets)})
bpy.ops.object.select_all(action='DESELECT'); root.select_set(True)
for o in root.children_recursive: o.select_set(True)
bpy.context.view_layer.objects.active=root
bpy.ops.export_scene.gltf(filepath=str(OUT/'atlas-amphibious.glb'),export_format='GLB',use_selection=True,export_yup=True,
    export_apply=True,export_extras=True,export_cameras=False,export_lights=False,export_animations=True,
    export_animation_mode='NLA_TRACKS',export_frame_step=1)
for o in root.children_recursive:
    if o.type=='MESH': o.data.calc_loop_triangles()
meta={'name':'ATLAS Amphibious','source':'atlas-amphibious.blend','asset':'atlas-amphibious.glb','duration':2.4,'flightDuration':1.6,
    'triangles':sum(len(o.data.loop_triangles) for o in root.children_recursive if o.type=='MESH'),
    'meshes':sum(o.type=='MESH' for o in root.children_recursive),'batching':batching,
    'transformParts':[o.name for o in root.children_recursive if o.get('clip')=='Transform_To_Boat'],
    'flightParts':[o.name for o in root.children_recursive if o.get('clip')=='Transform_To_Plane']}
(OUT/'atlas-amphibious.json').write_text(json.dumps(meta,indent=2)+'\n')
print('AMPHIBIOUS_EXPORT '+json.dumps(meta))
