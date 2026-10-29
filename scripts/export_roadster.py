"""Export an edited Roadster .blend without rebuilding its authored geometry.

Run Blender --background assets/vehicles/roadster-rocket.blend --python scripts/export_roadster.py
"""
import bpy
import json
from pathlib import Path


def export_roadster(root, OUT, source_parts):
    # Evaluate bevels/normals and batch independently within each animated group
    # (the body, each wheel, the tilting wing). The Exhaust_* empties stay as
    # their own nodes for the game's plumes.
    body = next(child for child in root.children if child.name == 'Body')
    wheel_groups = [bpy.data.objects['Spinner_'+name] for name in ('FL', 'RL', 'FR', 'RR')]
    export_groups = [body, *wheel_groups, bpy.data.objects['Rear_Wing']]
    def owner(o):
        # The nearest export group above a part: the wing's parts aren't the body's.
        while o.parent not in export_groups: o = o.parent
        return o.parent
    batching = []
    for group in export_groups:
        objects = [o for o in group.children_recursive if o.type in {'MESH', 'CURVE', 'FONT'} and owner(o) is group]
        group['sourceParts'] = len(objects)
        buckets = {}
        for o in objects:
            # Preserve authored bevels; batch by material without decimating the surfaces.
            bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
            bpy.ops.object.convert(target='MESH')
            o = bpy.context.object
            buckets.setdefault(o.data.materials[0].name, []).append(o)
        for material_name, parts in buckets.items():
            bpy.ops.object.select_all(action='DESELECT')
            for o in parts: o.select_set(True)
            bpy.context.view_layer.objects.active = parts[0]
            bpy.ops.object.join(); joined = bpy.context.object
            transform = joined.matrix_world.copy(); joined.parent = group; joined.matrix_world = transform
            # Bake the batch into its group's frame. It would otherwise keep its
            # first part's rotation, and a rotated box round the whole batch
            # (three.js's quick bounds, which the garage frames by) balloons.
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            joined.name = group.name+'__'+material_name
        batching.append({'group': group.name, 'before': len(objects), 'after': len(buckets)})
    bpy.ops.object.select_all(action='DESELECT'); root.select_set(True)
    for o in root.children_recursive: o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=str(OUT/'roadster-rocket.glb'), export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_extras=True, export_cameras=False, export_lights=False, export_animations=False)
    # Include evaluated modifiers on unbatched parts such as the fixed calipers.
    depsgraph = bpy.context.evaluated_depsgraph_get()
    tris = 0
    for o in root.children_recursive:
        if o.type == 'MESH':
            evaluated = o.evaluated_get(depsgraph)
            geometry = evaluated.to_mesh()
            geometry.calc_loop_triangles()
            tris += len(geometry.loop_triangles)
            evaluated.to_mesh_clear()
    # Thruster mouths in game axes (X right, Y up, Z forward), from the Blender empties.
    thrusters = [{'name': o.name, 'position': [round(v, 4) for v in (o.matrix_world.translation.x, o.matrix_world.translation.z, -o.matrix_world.translation.y)], 'thrust': [round(v, 4) for v in o['thrust']]}
        for o in body.children if o.name.startswith('Exhaust_')]
    metadata = {'name': 'Roadster Rocket', 'revision': root.get('revision', 1),
        'reference': root.get('reference', 'https://www.tesla.com/roadster'),
        'source': 'roadster-rocket.blend', 'asset': 'roadster-rocket.glb', 'sourceParts': source_parts, 'triangles': tris, 'batching': batching,
        'wheelRadius': {'front': .343, 'rear': .367}, 'tyres': {'front': '295/30 R20', 'rear': '335/30 R21'}, 'wheelbase': 2.82, 'track': {'front': 1.69, 'rear': 1.66},
        'length': 4.37, 'width': 2.0, 'height': 1.1, 'thrusters': thrusters, 'axes': 'X right, Y up, Z forward (glTF)',
        'materials': sorted({slot.material.name for o in root.children_recursive if o.type == 'MESH' for slot in o.material_slots})}
    (OUT/'roadster-rocket.json').write_text(json.dumps(metadata, indent=2)+'\n')
    print('ROADSTER_EXPORT '+json.dumps(metadata))


if __name__ == '__main__':
    root = bpy.data.objects.get('Roadster_Rocket')
    if root is None:
        raise RuntimeError('Open roadster-rocket.blend before running this export script')
    out = Path(__file__).resolve().parents[1] / 'assets' / 'vehicles'
    count = len([o for o in root.children_recursive if o.type in {'MESH', 'CURVE', 'FONT'}])
    export_roadster(root, out, count)
