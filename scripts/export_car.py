"""Export an edited ATLAS .blend without rebuilding its authored geometry.

Run Blender --background assets/vehicles/atlas-expedition.blend --python scripts/export_car.py
"""
import bpy
import json
from pathlib import Path


def export_car(root, OUT, source_parts):
    # Evaluate bevels/normals and batch independently within each animated group.
    body=next(child for child in root.children if child.name=='Body')
    wheel_groups=[bpy.data.objects['Spinner_'+name] for name in ('FL','RL','FR','RR')]
    export_groups=[body,*wheel_groups]
    batching=[]
    for group in export_groups:
        objects=[o for o in group.children_recursive if o.type in {'MESH','CURVE','FONT'}]
        group['sourceParts']=len(objects)
        buckets={}
        for o in objects:
            # Keep the rich editable bevels in the .blend; reduce tiny fillets for play.
            for mod in o.modifiers:
                if mod.type=='BEVEL': mod.segments=1 if max(o.dimensions)<.35 else 2
            bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active=o
            bpy.ops.object.convert(target='MESH')
            o=bpy.context.object
            buckets.setdefault(o.data.materials[0].name,[]).append(o)
        for material_name,parts in buckets.items():
            bpy.ops.object.select_all(action='DESELECT')
            for o in parts: o.select_set(True)
            bpy.context.view_layer.objects.active=parts[0]
            bpy.ops.object.join(); joined=bpy.context.object
            transform=joined.matrix_world.copy(); joined.parent=group; joined.matrix_world=transform
            joined.name=group.name+'__'+material_name
            # Collapse redundant curvature samples after merging. Preserve UV borders
            # and authored normals; this asset uses material colors, not image maps.
            # Window panes are already minimal quads; reduction can erase a pane.
            if material_name != 'Smoked_Glass':
                mod=joined.modifiers.new('Game mesh reduction','DECIMATE'); mod.ratio=.48
                bpy.ops.object.modifier_apply(modifier=mod.name)
        batching.append({'group':group.name,'before':len(objects),'after':len(buckets)})
    bpy.ops.object.select_all(action='DESELECT'); root.select_set(True)
    for o in root.children_recursive: o.select_set(True)
    bpy.context.view_layer.objects.active=root
    bpy.ops.export_scene.gltf(filepath=str(OUT/'atlas-expedition.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_extras=True,export_cameras=False,export_lights=False,export_animations=False)
    for o in root.children_recursive:
        if o.type=='MESH': o.data.calc_loop_triangles()
    tris=sum(len(o.data.loop_triangles) for o in root.children_recursive if o.type=='MESH')
    metadata={'name':'ATLAS Expedition 4x4','source':'atlas-expedition.blend','asset':'atlas-expedition.glb','sourceParts':source_parts,'triangles':tris,'batching':batching,'wheelRadius':.57,'wheelbase':2.74,'track':2.08,'axes':'X right, Y up, Z forward (glTF)','materials':sorted({slot.material.name for o in root.children_recursive if o.type=='MESH' for slot in o.material_slots})}
    (OUT/'atlas-expedition.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print('ATLAS_EXPORT '+json.dumps(metadata))


if __name__ == '__main__':
    root = bpy.data.objects.get('Atlas_Expedition')
    if root is None:
        raise RuntimeError('Open atlas-expedition.blend before running this export script')
    out = Path(__file__).resolve().parents[1] / 'assets' / 'vehicles'
    count = len([o for o in root.children_recursive if o.type in {'MESH', 'CURVE', 'FONT'}])
    export_car(root, out, count)
