"""Export edited scenery: Blender --background assets/nature/endless-nature.blend --python scripts/export_nature.py"""
import bpy
import json
from pathlib import Path

def export_nature(roots,out):
    stats=[]
    for root in roots:
        parts=[o for o in root.children_recursive if o.type=='MESH']
        buckets={}
        for o in parts: buckets.setdefault(o.get('fragment',0),[]).append(o)
        for section,objects in sorted(buckets.items()):
            bpy.ops.object.select_all(action='DESELECT')
            for o in objects: o.select_set(True)
            bpy.context.view_layer.objects.active=objects[0]; bpy.ops.object.join()
            o=bpy.context.object; o.name=root.name+'_Part_'+str(section)
            o.data.calc_loop_triangles()
        triangles=sum(len(o.data.loop_triangles) for o in root.children if o.type=='MESH')
        stats.append({'name':root.name,'kind':root['kind'],'variant':root['variant'],'triangles':triangles,'parts':len(buckets)})
    bpy.ops.object.select_all(action='DESELECT')
    for root in roots:
        root.select_set(True)
        for o in root.children_recursive: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(out/'endless-nature.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_extras=True,export_cameras=False,export_lights=False,export_animations=False)
    report={'name':'Endless Drive / original Blender nature library','assets':stats,'axes':'X right, Y up, Z forward; each asset root is its ground origin','materials':'opaque vertex colors, no external textures','treeFragments':'six authored closed sections per tree, assembled without cutting at runtime'}
    (out/'endless-nature.json').write_text(json.dumps(report,indent=2)+'\n')
    print('NATURE_EXPORT '+json.dumps(report))

if __name__=='__main__':
    roots=[o for o in bpy.context.scene.objects if o.type=='EMPTY' and 'kind' in o]
    if not roots: raise RuntimeError('Open endless-nature.blend before exporting')
    export_nature(roots,Path(__file__).resolve().parents[1]/'assets'/'nature')
