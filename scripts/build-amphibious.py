"""Author ATLAS's reversible car-to-boat transformation in Blender.

Blender --background --python scripts/build-amphibious.py
Reuses the editable expedition car, preserving its original source asset.
Frames 1–121: unlatch, spread body hulls, fold wheels, extend bow, deploy jets.
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

left=group('Hull_L',(-.85,.75,0)); right=group('Hull_R',(.85,.75,0))
bow=group('Bow_Extension',(0,1.2,1.1)); stern=group('Stern_Deck',(0,.7,-1.8))
cabin=group('Cabin_Slide',(0,1.5,-.6)); keel=group('Keel_Deploy',(0,.53,0))
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

# Boat hulls are packed inside the car's side sills; they telescope lengthwise
# and swing outward with the body panels rather than replacing the car mesh.
for sign,label,parent in [(-1,'L',left),(1,'R',right)]:
    pod=group('Pontoon_'+label,(sign*.8,.64,0),parent)
    bpy.context.view_layer.update()
    # Build at local game coordinates, then place the folded module in its sill.
    pod.location=p((sign*.05,-.11,0))
    profile=[(-2.7,.15,.12),(-2.3,.42,.05),(1.6,.45,.08),(2.65,.09,.37)]
    verts=[]
    for z,w,y in profile: verts.extend([(sign*.8-w,y,z),(sign*.8+w,y,z),(sign*.8+w,.82,z),(sign*.8-w,.82,z)])
    faces=[(0,3,2,1)]
    for j in range(3):
        for k in range(4): faces.append((j*4+k,j*4+(k+1)%4,(j+1)*4+(k+1)%4,(j+1)*4+k))
    faces.append((12,13,14,15))
    # Temporarily put the group at its world origin before preserving meshes.
    pod.location=p((sign*.8,.64,0))-parent.location; bpy.context.view_layer.update()
    mesh('Copper marine hull '+label,verts,faces,pod)
    box('Hull deck '+label,(sign*.8,.845,0),(.75,.06,4.25),pod,'Graphite')
    for zz in [-1.7,-1.1,-.5,.1,.7,1.3]: box('Deck grip '+label,(sign*.8,.883,zz),(.57,.013,.042),pod,'Brushed_Alloy',.003)
    animate(pod,[(1,(0,0,0),(0,0,0),(.4,.3,.6)),(30,(0,0,0),(0,0,0),(.4,.3,.6)),
        (88,(sign*.2,-.02,.1),(0,0,0),(1,1,1)),(121,(sign*.2,-.02,.1),(0,0,0),(1,1,1))])
    for zz in (-1.15,1.15): beam('Hull hydraulic ram '+label,(sign*.38,.68,zz),(sign*1.27,.7,zz),.05,parent)
    animate(parent,[(1,(0,0,0),(0,0,0),(1,1,1)),(22,(sign*.08,.025,0),(0,0,0),(1,1,1)),
        (72,(sign*.58,-.16,.08),(0,0,sign*.08),(1,1,1)),(121,(sign*.58,-.16,.08),(0,0,sign*.08),(1,1,1))])

for name in ('FL','RL','FR','RR'):
    wheel=bpy.data.objects['Wheel_'+name]; sign=-1 if name.endswith('L') else 1
    fold=group('WheelFold_'+name,parent=root)
    bpy.context.view_layer.update(); adopt(wheel,fold)
    # A sliding hinge outside each axle rotates the original tire flat, visibly.
    centre_at=wheel.location.copy(); fold.location=centre_at; wheel.location=(0,0,0)
    animate(fold,[(1,(0,0,0),(0,0,0),(1,1,1)),(16,(sign*.12,.08,0),(0,0,0),(1,1,1)),
        (65,(sign*.34,.66,0),(0,0,-sign*math.pi/2),(1,1,1)),(121,(sign*.34,.66,0),(0,0,-sign*math.pi/2),(1,1,1))])

# The skid-pan grows into a pointed, sealed central bow with a silver keel edge.
verts=[(-.72,.43,-1.85),(.72,.43,-1.85),(.69,.45,1.6),(0,.24,3.7),(-.69,.45,1.6),
       (-.88,.8,-1.85),(.88,.8,-1.85),(.85,.91,1.55),(0,.82,3.7),(-.85,.91,1.55)]
mesh('Unfolding centre hull',verts,[(0,4,3,2,1),(5,6,7,8,9)]+[(i,(i+1)%5,(i+1)%5+5,i+5) for i in range(5)],keel)
beam('Port bow chine',(-.68,.5,1.55),(0,.55,3.7),.025,keel)
beam('Starboard bow chine',(.68,.5,1.55),(0,.55,3.7),.025,keel)
bridge=group('Bridge_Deck',(0,.8,.3)); bpy.context.view_layer.update()
box('Telescoping sealed bridge',(0,1.23,1.05),(1.5,.12,2.3),bridge)
for zz in (.45,.7,.95,1.2,1.45,1.7): box('Bridge cooling fin',(0,1.297,zz),(1.22,.016,.032),bridge,'Brushed_Alloy',.003)
for sign in (-1,1): beam('Bow extension rail',(sign*.69,1.31,0),(sign*.69,1.31,2.16),.045,bridge)
animate(bridge,[(1,(0,0,0),(0,0,0),(1,.12,.18)),(25,(0,0,0),(0,0,0),(1,.12,.18)),
    (95,(0,0,0),(0,0,0),(1,1,1)),(121,(0,0,0),(0,0,0),(1,1,1))])
animate(keel,[(1,(0,0,0),(0,0,0),(.85,.12,.52)),(24,(0,0,0),(0,0,0),(.85,.12,.52)),
    (95,(0,-.07,.25),(0,0,0),(1.4,1,1.14)),(121,(0,-.07,.25),(0,0,0),(1.4,1,1.14))])
animate(bow,[(1,(0,0,0),(0,0,0),(1,1,1)),(25,(0,.12,.1),(-.06,0,0),(1,1,1)),
    (90,(0,-.18,.84),(-.08,0,0),(1.16,1,1.08)),(121,(0,-.18,.84),(-.08,0,0),(1.16,1,1.08))])
animate(cabin,[(1,(0,0,0),(0,0,0),(1,1,1)),(34,(0,.08,-.05),(0,0,0),(1,1,1)),
    (95,(0,-.14,-.25),(0,0,0),(1,1,.96)),(121,(0,-.14,-.25),(0,0,0),(1,1,.96))])
animate(stern,[(1,(0,0,0),(0,0,0),(1,1,1)),(55,(0,0,0),(0,0,0),(1,1,1)),
    (108,(0,.02,-.6),(0,0,0),(1.4,1,1)),(121,(0,.02,-.6),(0,0,0),(1.4,1,1))])
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

root['asset']='ATLAS Amphibious / mechanically transforming expedition vehicle'
root['transformDuration']=2.4
scene.timeline_markers.clear()
for name,frame in [('CAR',1),('UNLATCH',22),('WHEELS FOLD / HULL SPREAD',65),('BOW EXTENDS',95),('BOAT / JETS LOCK',121)]: scene.timeline_markers.new(name,frame=frame)
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
        if mat!='Smoked_Glass':
            mod=o.modifiers.new('Game reduction','DECIMATE'); mod.ratio=.48; bpy.ops.object.modifier_apply(modifier=mod.name)
    batching.append({'group':parent.name,'before':len(parts),'after':len(buckets)})
bpy.ops.object.select_all(action='DESELECT'); root.select_set(True)
for o in root.children_recursive: o.select_set(True)
bpy.context.view_layer.objects.active=root
bpy.ops.export_scene.gltf(filepath=str(OUT/'atlas-amphibious.glb'),export_format='GLB',use_selection=True,export_yup=True,
    export_apply=True,export_extras=True,export_cameras=False,export_lights=False,export_animations=True,
    export_animation_mode='SCENE',export_anim_scene_split_object=False,export_frame_range=True,export_frame_step=1)
for o in root.children_recursive:
    if o.type=='MESH': o.data.calc_loop_triangles()
meta={'name':'ATLAS Amphibious','source':'atlas-amphibious.blend','asset':'atlas-amphibious.glb','duration':2.4,
    'triangles':sum(len(o.data.loop_triangles) for o in root.children_recursive if o.type=='MESH'),
    'meshes':sum(o.type=='MESH' for o in root.children_recursive),'batching':batching,
    'transformParts':[o.name for o in root.children_recursive if o.get('transformPart')]}
(OUT/'atlas-amphibious.json').write_text(json.dumps(meta,indent=2)+'\n')
print('AMPHIBIOUS_EXPORT '+json.dumps(meta))
