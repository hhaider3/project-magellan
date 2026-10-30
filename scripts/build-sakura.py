import bpy, math, random, json, os
import numpy as np
from mathutils import Vector, Quaternion
from pathlib import Path
OUT=Path(__file__).resolve().parent.parent/'assets'/'nature'/'sakura-realistic'
OUT.mkdir(parents=True,exist_ok=True)
random.seed(27419)
bpy.ops.wm.read_factory_settings(use_empty=True)

def material(name,color,rough=.75):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=(*color,1); bs.inputs['Roughness'].default_value=rough
    return m

def mesh_obj(name,vs,fs,mats,inds=None,uvs=None):
    me=bpy.data.meshes.new(name); me.from_pydata(vs,[],fs); me.update()
    ob=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(ob)
    for m in mats: me.materials.append(m)
    if inds:
        for p,i in zip(me.polygons,inds): p.material_index=i
    if uvs:
        uv=me.uv_layers.new(name='UVMap')
        for p,coords in zip(me.polygons,uvs):
            for li,co in zip(p.loop_indices,coords): uv.data[li].uv=co
    return ob

def aim(ob,point): ob.rotation_euler=(Vector(point)-ob.location).to_track_quat('-Z','Y').to_euler()
def area(name,loc,power,size,color):
    d=bpy.data.lights.new(name,'AREA'); d.energy=power; d.shape='DISK'; d.size=size; d.color=color
    o=bpy.data.objects.new(name,d); bpy.context.collection.objects.link(o); o.location=loc; aim(o,(0,0,0)); return o

def tube(vs,fs,uvs,pts,radii,sides,seed=0):
    base=len(vs); length=0
    for j,pt in enumerate(pts):
        pt=Vector(pt)
        tangent=Vector(pts[min(j+1,len(pts)-1)])-Vector(pts[max(0,j-1)])
        q=Vector((0,0,1)).rotation_difference(tangent.normalized())
        if j: length+=(pt-Vector(pts[j-1])).length
        for k in range(sides):
            a=2*math.pi*k/sides
            r=radii[j]*(1+.09*math.sin(k*5.2+seed)+.04*math.sin(j*2+k))
            vs.append(tuple(pt+q@Vector((math.cos(a)*r,math.sin(a)*r,0))))
        if j:
            for k in range(sides):
                a=base+(j-1)*sides+k; b=base+(j-1)*sides+(k+1)%sides; c=base+j*sides+(k+1)%sides; d=base+j*sides+k
                fs.append((a,b,c,d)); uvs.append(((k/sides,(length-(pt-Vector(pts[j-1])).length)*.8),((k+1)/sides,(length-(pt-Vector(pts[j-1])).length)*.8),((k+1)/sides,length*.8),(k/sides,length*.8)))
    fs.append(tuple(base+k for k in reversed(range(sides)))); uvs.append(tuple((.5+.5*math.cos(k*2*math.pi/sides),.5+.5*math.sin(k*2*math.pi/sides)) for k in reversed(range(sides))))
    fs.append(tuple(base+(len(pts)-1)*sides+k for k in range(sides))); uvs.append(tuple((.5+.5*math.cos(k*2*math.pi/sides),.5+.5*math.sin(k*2*math.pi/sides)) for k in range(sides)))

# Render an original, geometrically modelled blossom spray to a transparent atlas.
petalmats=[material('Atlas petal '+str(i),c,.62) for i,c in enumerate([(1,.73,.78),(1,.83,.85),(.98,.91,.88),(.89,.52,.63),(.72,.26,.39)])]
for m in petalmats:
    m.node_tree.nodes.get('Principled BSDF').inputs['Subsurface Weight'].default_value=.11
pollen=material('Pollen',(.83,.53,.15)); twigmat=material('Atlas twig',(.19,.10,.075))
vs=[]; fs=[]; mi=[]
flower_positions=[]
for i in range(65):
    a=random.uniform(0,math.tau); r=.40*math.sqrt(random.random())
    x=math.cos(a)*r*.9; y=math.sin(a)*r
    flower_positions.append((x,y,random.uniform(-.025,.025)))
    scale=random.uniform(.022,.035); rot=random.uniform(0,math.tau)
    for p in range(5):
        angle=rot+p*math.tau/5
        # Broad petal with the characteristic shallow sakura notch.
        outline=[(0,.006),(-.48,.38),(-.57,.77),(-.35,1.02),(0,.88),(.35,1.02),(.57,.77),(.48,.38)]
        # Catmull-Rom outline and concentric rings keep rendered petals rounded.
        curve=[]
        for oi in range(8):
            p0=Vector(outline[(oi-1)%8]); p1=Vector(outline[oi]); p2=Vector(outline[(oi+1)%8]); p3=Vector(outline[(oi+2)%8])
            for step in range(4):
                t=step/4
                curve.append(.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t))
        b=len(vs); shade=random.choices([0,1,2],[15,40,45])[0]
        for ring in range(4):
            fac=(ring+1)/4
            for point in curve:
                px=point.x*fac; py=.48+(point.y-.48)*fac
                z=.005+scale*(.20*py*py+.13*px*px)+scale*.035*math.sin(px*9+py*5)
                vs.append((x+(px*math.cos(angle)+py*math.sin(angle))*scale,y+(-px*math.sin(angle)+py*math.cos(angle))*scale,z))
            if ring:
                for j in range(32):
                    fs.append((b+(ring-1)*32+j,b+(ring-1)*32+(j+1)%32,b+ring*32+(j+1)%32,b+ring*32+j)); mi.append(shade)
        fs.append(tuple(b+j for j in reversed(range(32)))); mi.append(shade)
    for k in range(9):
        a=k*math.tau/9; r=scale*random.uniform(.12,.30)
        xx=x+math.cos(a)*r; yy=y+math.sin(a)*r
        b=len(vs); rr=.0018
        vs.extend([(xx-rr,yy-rr,.022),(xx+rr,yy-rr,.022),(xx+rr,yy+rr,.022),(xx-rr,yy+rr,.022)])
        fs.append((b,b+1,b+2,b+3)); mi.append(5)
spray=mesh_obj('Original blossom spray',vs,fs,petalmats+[pollen],mi)
for poly in spray.data.polygons: poly.use_smooth=True
vs=[];fs=[];uv=[]
for x,y,z in flower_positions:
    tube(vs,fs,uv,[(x*.5,y*.6-.12,-.03),(x*.7,y*.85-.04,-.025),(x,y,-.01)],[.0016,.0012,.0007],4)
mesh_obj('Spray twigs',vs,fs,[twigmat])
sc=bpy.context.scene; sc.render.engine='CYCLES'; sc.cycles.samples=24
sc.render.resolution_x=1024; sc.render.resolution_y=1024; sc.render.resolution_percentage=100
sc.render.film_transparent=True; sc.world=bpy.data.worlds.new('Atlas World'); sc.world.use_nodes=True; sc.world.node_tree.nodes['Background'].inputs[0].default_value=(.7,.7,.7,1); sc.world.node_tree.nodes['Background'].inputs[1].default_value=.7
area('Atlas softbox',(-1,-1,3),80,3,(1,.94,.88))
camd=bpy.data.cameras.new('Atlas camera'); cam=bpy.data.objects.new('Atlas camera',camd); sc.collection.objects.link(cam); cam.location=(0,0,3); camd.type='ORTHO'; camd.ortho_scale=1.02; sc.camera=cam
sc.view_settings.view_transform='Standard'; sc.render.image_settings.file_format='PNG'; sc.render.image_settings.color_mode='RGBA'; sc.render.filepath=str(OUT/'sakura_blossoms.png'); bpy.ops.render.render(write_still=True)
# The final scene is built afresh and never reads any existing project assets.
bpy.ops.wm.read_factory_settings(use_empty=True); random.seed(61842); sc=bpy.context.scene
sc.unit_settings.system='METRIC'; sc.render.fps=30; sc.frame_start=1; sc.frame_end=241
asset=bpy.data.collections.new('SAKURA • game asset'); sc.collection.children.link(asset)
preview=bpy.data.collections.new('STUDIO • excluded from exports'); sc.collection.children.link(preview)
def move_to(ob,collection):
    for c in list(ob.users_collection): c.objects.unlink(ob)
    collection.objects.link(ob)
def tris(ob): ob.data.calc_loop_triangles(); return len(ob.data.loop_triangles)
# UV bark texture with fine grain, fissures and cherry bark's horizontal lenticels.
h,w=1024,512; yy,xx=np.mgrid[0:h,0:w]; rng=np.random.default_rng(71)
field=.012*np.sin(xx*.19+3*np.sin(yy*.009))+.009*np.sin(xx*.62+np.sin(yy*.025))+.009*rng.normal(size=(h,w))
base=np.zeros((h,w,4),dtype=np.float32); base[:,:,:3]=np.array([.24,.16,.135])[None,None,:]+field[:,:,None]; base[:,:,3]=1
for i in range(490):
    x=int(rng.integers(0,w)); y=int(rng.integers(0,h)); wid=int(rng.integers(3,23)); thick=int(rng.integers(1,3))
    base[y:y+thick,max(0,x-wid):min(w,x+wid),:3]+=rng.uniform(.025,.11)
base=np.clip(base,0,1)
barkimg=bpy.data.images.new('Cherry bark • original',width=w,height=h); barkimg.pixels.foreach_set(base.ravel()); barkimg.filepath_raw=str(OUT/'sakura_bark.png'); barkimg.file_format='PNG'; barkimg.save(); barkimg.pack()
bark=material('Cherry bark',(.26,.17,.14),.86); nodes=bark.node_tree.nodes; tex=nodes.new('ShaderNodeTexImage'); tex.image=barkimg; bark.node_tree.links.new(tex.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
bump=nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.18; bump.inputs['Distance'].default_value=.028; bark.node_tree.links.new(tex.outputs['Color'],bump.inputs['Height']); bark.node_tree.links.new(bump.outputs[0],nodes.get('Principled BSDF').inputs['Normal'])
blossom=material('Blossoms • alpha cutout',(.98,.80,.82),.82); blossom.use_backface_culling=False
bs=blossom.node_tree.nodes.get('Principled BSDF'); bs.inputs['Specular IOR Level'].default_value=.23
im=bpy.data.images.load(str(OUT/'sakura_blossoms.png')); im.pack(); tex=blossom.node_tree.nodes.new('ShaderNodeTexImage'); tex.image=im
blossom.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
cut=blossom.node_tree.nodes.new('ShaderNodeMath'); cut.operation='GREATER_THAN'; cut.inputs[1].default_value=.37; blossom.node_tree.links.new(tex.outputs['Alpha'],cut.inputs[0]); blossom.node_tree.links.new(cut.outputs[0],bs.inputs['Alpha'])
blossom.surface_render_method='DITHERED'; blossom['gltf_alpha_mode']='MASK'; blossom.alpha_threshold=.37
petalmat=material('Falling petals',(.96,.68,.75),.75); petalmat.use_backface_culling=False
# Root flare and crooked trunk.
vs=[];fs=[];uv=[]
trunk=[]
for j in range(13):
    t=j/12; trunk.append((.24*math.sin(t*3.7),.13*math.sin(t*4.2),t*3.35))
tube(vs,fs,uv,trunk,[.43*(1-j/15)**1.25+.035 for j in range(13)],12,2)
for i in range(7):
    a=i*math.tau/7+.2; end=Vector((math.cos(a),math.sin(a),0))*random.uniform(.8,1.2)
    tube(vs,fs,uv,[(0,0,.18),(end.x*.4,end.y*.4,.10),(end.x,end.y,.015)],[.24,.13,.012],7,i)
anchors=[]; tips=[]
for i in range(8):
    a=i*2.39996+.4; height=2.05+(i%3)*.40; length=random.uniform(2.35,3.45); rise=random.uniform(1.7,2.5)
    start=Vector((.18,.04,height)); pts=[]
    for j in range(9):
        t=j/8; pts.append(tuple(start+Vector((math.cos(a)*length*t,math.sin(a)*length*t,rise*(t**.72)+.10*math.sin(t*5)))))
    tube(vs,fs,uv,pts,[.19*(1-j/9)**1.35+.008 for j in range(9)],8,i)
    for k in range(4):
        origin=Vector(pts[3+k]); aa=a+(-1 if k%2 else 1)*random.uniform(.35,.95); le=random.uniform(.8,1.55)
        dest=origin+Vector((math.cos(aa)*le,math.sin(aa)*le,random.uniform(.65,1.3)))
        pp=[tuple(origin.lerp(dest,j/5)+Vector((.05*math.sin(j),.06*math.sin(j*1.2),.09*math.sin(j*math.pi/5)))) for j in range(6)]
        tube(vs,fs,uv,pp,[.067*(1-j/5)**1.25+.004 for j in range(6)],5,k)
        anchors.append((dest,Vector((.90,.8,.65))))
        for s in [-1,1]:
            o=Vector(pp[3]); aa2=aa+s*.8; d=o+Vector((math.cos(aa2)*.67,math.sin(aa2)*.67,.55))
            tube(vs,fs,uv,[tuple(o),tuple(o.lerp(d,.5)+Vector((0,0,.10))),tuple(d)],[.024,.012,.0025],4,k)
            tips.append(d)
wood=mesh_obj('Sakura_Trunk_Branches',vs,fs,[bark],uvs=uv); move_to(wood,asset)
for p in wood.data.polygons: p.use_smooth=True
# Each loose petal has a shallow notch and a curved midrib (six triangles).
pv=[(0,-.045,0),(-.025,-.008,.006),(-.027,.025,.009),(-.010,.044,.012),(0,.034,.009),(.013,.045,.012),(.029,.022,.008),(.024,-.009,.004)]
pf=[(0,j,j+1) for j in range(1,7)]
petalmesh=bpy.data.meshes.new('Petal reusable geometry'); petalmesh.from_pydata(pv,[],pf); petalmesh.materials.append(petalmat)
fall=[]
for i in range(72):
    ob=bpy.data.objects.new('Falling_Petal_%03d'%i,petalmesh); asset.objects.link(ob); fall.append(ob)
    anchor=random.choice(anchors)[0]; sx=anchor.x+random.uniform(-.8,.8); sy=anchor.y+random.uniform(-.8,.8); sz=anchor.z+random.uniform(-.3,.3)
    phase=random.random(); twist=random.uniform(0,math.tau); ob['petal_phase']=phase; ob['spawn']=[sx,sy,sz]; ob['twist']=twist
    # Sampled transforms survive glTF export; all particles share one animation clip.
    for f in range(1,242):
        age=((f-1)/240+phase)%1; s=min(1,age/.055,(1-age)/.055)
        ob.location=(sx+age*1.5+.23*math.sin(age*math.tau*2+twist),sy+.25*math.sin(age*math.tau*3+twist),sz*(1-age)+.035)
        ob.rotation_euler=(twist+age*9,.4+age*6,twist+age*5); ob.scale=(s,s,s)
        for prop in ['location','rotation_euler','scale']: ob.keyframe_insert(data_path=prop,frame=f)
    ob.animation_data.action.name='Petal fall %03d'%i
# Discrete ground petals, separate optional mesh.
vs=[];fs=[]
for i in range(65):
    a=random.uniform(0,math.tau); r=random.uniform(.6,3.8); q=Quaternion((0,0,1),random.uniform(0,math.tau)); off=Vector((math.cos(a)*r+.5,math.sin(a)*r,.014)); b=len(vs)
    vs.extend([tuple(off+q@Vector(v)*random.uniform(.8,1.1)) for v in pv]); fs.extend([tuple(b+j for j in f) for f in pf])
ground=mesh_obj('Sakura_Ground_Petals_optional',vs,fs,[petalmat]); move_to(ground,asset)
# 2x2 bent cards use eight triangles, so canopy density fills the remaining budget.
wood_count=tris(wood); ground_count=tris(ground); falling_count=72*6
card_count=(10000-wood_count-ground_count-falling_count)//8
# Fit the cards to the spray. Only about a sixth of the atlas is blossom, and
# the GPU rasterizes, samples and discards the rest of every card it draws, in
# every layer of the canopy and every shadow map. Each card becomes an octagon
# around its centre, its corners on the grid's own eight rays (the four
# corners and four edge midpoints), each pushed out only as far as the opaque
# blossom in its two sectors needs. Still eight triangles, as a fan.
alpha=np.array(im.pixels[:],dtype=np.float32).reshape(im.size[1],im.size[0],4)[:,:,3]
ys,xs=np.nonzero(alpha>.2) # under the .37 cutoff, so softened edges stay in
cu=(xs+.5)/im.size[0]-.5; cv=(ys+.5)/im.size[1]-.5
rays=[(math.cos(k*math.tau/8),math.sin(k*math.tau/8)) for k in range(8)]
limit=[.5/max(abs(x),abs(y)) for x,y in rays] # out to the card's own edge
sector=((np.arctan2(cv,cu)%math.tau)//(math.tau/8)).astype(int)%8
along=lambda k: cu*rays[k][0]+cv*rays[k][1]
fit=[float(along(k)[(along(k)>0)&(np.abs(cu*rays[k][1]-cv*rays[k][0])<.04)].max(initial=.05)) for k in range(8)]
for k in range(8):
    # A point s·ray k + t·ray k+1 lies inside the fan triangle when s/fit[k] + t/fit[k+1] ≤ 1.
    a,b=rays[k],rays[(k+1)%8]; m=sector==k; det=a[0]*b[1]-a[1]*b[0]
    s=(cu[m]*b[1]-cv[m]*b[0])/det; t=(a[0]*cv[m]-a[1]*cu[m])/det
    need=float((s/fit[k]+t/fit[(k+1)%8]).max(initial=0))
    if need>1: fit[k]*=need; fit[(k+1)%8]*=need
fit=[min(f*1.02,l) for f,l in zip(fit,limit)]
outline=[(.5+x*f,.5+y*f) for (x,y),f in zip(rays,fit)]
octagon=sum(fit[k]*fit[(k+1)%8]*math.sin(math.tau/8)/2 for k in range(8))
print('SAKURA_CARD_FIT',json.dumps({'outline':[[round(u,3),round(v,3)] for u,v in outline],'card_area':round(octagon,3)}),flush=True)
vs=[];fs=[];uv=[]
for i in range(card_count):
    center,rad=anchors[i%len(anchors)]
    d=Vector((random.gauss(0,.50),random.gauss(0,.50),random.gauss(0,.40))); d=Vector((max(-1,min(1,v)) for v in d))
    pos=center+Vector((d.x*rad.x,d.y*rad.y,d.z*rad.z))
    direction=Vector((d.x,d.y,random.uniform(.25,1)))
    if i%4==0: direction=Vector((random.uniform(-1,1),random.uniform(-1,1),random.uniform(-.3,.3)))
    q=direction.normalized().to_track_quat('Z','Y') @ Quaternion((0,0,1),random.uniform(0,math.tau))
    size=random.uniform(.64,1.05); b=len(vs)
    # The same bent surface as the full card, sampled at the fitted outline.
    for u,v in [(.5,.5)]+outline:
        x,y=2*u-1,2*v-1
        vs.append(tuple(pos+q@Vector((x*size*.5,y*size*.5,-.11*size*(x*x+y*y)))))
    for k in range(8):
        fs.append((b,b+1+k,b+1+(k+1)%8)); uv.append(((.5,.5),outline[k],outline[(k+1)%8]))
canopy=mesh_obj('Sakura_Blossom_Canopy',vs,fs,[blossom],uvs=uv); move_to(canopy,asset)
for p in canopy.data.polygons: p.use_smooth=True
for ob in [wood,canopy,ground]: ob['triangle_count']=tris(ob)
root=bpy.data.objects.new('Sakura_Root',None); asset.objects.link(root)
for ob in list(asset.objects):
    if ob!=root: ob.parent=root
root['total_triangles']=wood_count+tris(canopy)+ground_count+falling_count
root['units']='meters'; root['animation']='Sakura_Petal_Fall: 8 seconds, loop'; sc.name='Sakura_Petal_Fall'; root['created_from_scratch']=True
# Save a standalone, small petal source for engine instancing.
source=bpy.data.objects.new('Sakura_Petal_Source',petalmesh); sc.collection.objects.link(source)
bpy.ops.object.select_all(action='DESELECT'); source.select_set(True); bpy.context.view_layer.objects.active=source
bpy.ops.export_scene.gltf(filepath=str(OUT/'sakura-petal.glb'),export_format='GLB',use_selection=True,export_animations=False)
bpy.data.objects.remove(source,do_unlink=True)
# Export only the game collection, with a single combined animation.
sc.frame_set(1); bpy.ops.object.select_all(action='DESELECT')
for ob in asset.objects: ob.select_set(True)
bpy.context.view_layer.objects.active=wood
normal_link=next((l for l in bark.node_tree.links if l.to_socket==bark.node_tree.nodes.get('Principled BSDF').inputs['Normal']),None)
if normal_link: bark.node_tree.links.remove(normal_link)
bpy.ops.export_scene.gltf(filepath=str(OUT/'sakura-tree.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='SCENE',export_anim_slide_to_zero=True,export_frame_range=True,export_force_sampling=True,export_current_frame=False,export_anim_scene_split_object=False,export_extras=True)
# Frame 241 is frame 1 again: the glTF keeps it as the closing key (so three.js
# interpolates frame 240 back into frame 1 over the last 1/30 s), but Blender's
# looping playback stops at 240, or it would show that pose twice and hitch.
sc.frame_end=240
# Quiet studio used only for the Blender preview.
floor=material('Studio floor',(.055,.075,.068),.95)
bpy.ops.mesh.primitive_plane_add(size=200); plane=bpy.context.object; plane.name='Studio ground (not exported)'; plane.data.materials.append(floor); plane.location.z=-.025; move_to(plane,preview)
sc.world=bpy.data.worlds.new('Studio World'); sc.world.use_nodes=True; sc.world.node_tree.nodes['Background'].inputs[0].default_value=(.34,.42,.48,1); sc.world.node_tree.nodes['Background'].inputs[1].default_value=.45
for ob in [area('Warm sky',(-4,-6,11),1900,7,(1,.90,.82)),area('Cool fill',(5,2,8),1250,6,(.78,.86,1)),area('Canopy rim',(-3,6,9),2300,5,(1,.79,.78))]: move_to(ob,preview)
camd=bpy.data.cameras.new('Preview Camera'); cam=bpy.data.objects.new('Preview Camera',camd); preview.objects.link(cam); cam.location=(10,-15,9); aim(cam,(.2,0,3.05)); camd.type='ORTHO'; camd.ortho_scale=11.5; sc.camera=cam
sc.render.engine='CYCLES'; sc.cycles.samples=24; sc.cycles.transparent_max_bounces=16; sc.cycles.use_denoising=True; sc.render.resolution_x=1400; sc.render.resolution_y=1400; sc.render.resolution_percentage=100
sc.view_settings.view_transform='AgX'; sc.render.image_settings.file_format='PNG'; sc.render.image_settings.color_mode='RGBA'; sc.render.film_transparent=False
sc.frame_set(81); sc.render.filepath=str(OUT/'sakura-preview.png')
# A useful starting view, without changing the user's running Blender session.
for screen in bpy.data.screens:
    for a in screen.areas:
        if a.type=='VIEW_3D':
            a.spaces.active.region_3d.view_distance=13; a.spaces.active.region_3d.view_location=(0,0,3); a.spaces.active.region_3d.view_rotation=cam.rotation_euler.to_quaternion(); a.spaces.active.shading.type='MATERIAL'
bpy.ops.object.select_all(action='DESELECT'); wood.select_set(True); canopy.select_set(True); bpy.context.view_layer.objects.active=wood
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'sakura-tree.blend'))
report={'total_triangles':root['total_triangles'],'wood_triangles':wood_count,'canopy_triangles':tris(canopy),'foliage_cards':card_count,'falling_petals':72,'falling_petal_triangles':falling_count,'ground_petal_triangles':ground_count,'animation_seconds':8,'fps':30,'source':'Original generated geometry; no existing project tree inspected.'}
(OUT/'asset-stats.json').write_text(json.dumps(report,indent=2)); print('SAKURA_STATS',json.dumps(report),flush=True)
bpy.ops.render.render(write_still=True)
