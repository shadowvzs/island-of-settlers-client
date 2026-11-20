"""Pirate ship LODs (owner-generated Blackwake and Red Viper, 2026-11-17).

blender -b --factory-startup -P pirate-ship-lods.py -- <blackwake.glb> <red-viper.glb> <out dir>

Both sources share every material except the sail cloth, so the second ship's materials are
remapped onto the first ship's and one texture set serves both. Writes
  pirate-ships-high.glb     lod0 (full), lod1 (mid) and lod2 (far) of both ships
  pirate-ships-minimal.glb  lod1 and lod2 only (the Minimal preset never draws lod0)
Levels pick parts by their source node names, then weld and decimate: generic simplification
cannot drop the hundreds of small rope and ornament islands, the part lists can.
"""
import sys

import bmesh
import bpy
from mathutils import Vector

SHIPS = ("blackwake", "red-viper")

# Hull half-beam (glTF x, metres = world units) the shared ship contract allows: hull contract beam 3.36
# plus the rail. The sources are wider (Blackwake 2.12, Red Viper 1.91), which would put the shared
# gangway contact and the pier side inside their bulwarks, so the hull is narrowed to it; the narrowing
# fades out up the rig (BEAM_FADE heights) so yards and sails keep their authored width and the
# shrouds stay attached at both ends.
CONTRACT_HALF_BEAM = 1.72
BEAM_FADE = (1.9, 6.0)

# part (source node "<group>.<material>") -> decimate ratio per level; missing = dropped.
MID_PARTS = {
    "ship_hull.tar-timber": .6, "ship_hull.red-wale": .6, "ship_hull.warm-timber": .35,
    "ship_hull.brass": .25, "ship_hull.deck-timber": .5, "ship_hull.iron": .5,
    "ship_hull.dark-recess": 1, "ship_rig.rope": .6, "ship_rig.tar-timber": 1,
    "ship_rig.warm-timber": 1, "ship_flag.pennant": .5, "ship_sail": .5,
    "ship_sail_edges.rope": .3, "ship_ornaments.lamp-glow": 1, "ship_ornaments.bone": .5,
    "ship_steering.warm-timber": 1, "ship_steering.iron": .4,
}
FAR_PARTS = {
    "ship_hull.tar-timber": .4, "ship_hull.red-wale": .5, "ship_hull.warm-timber": .12,
    "ship_hull.deck-timber": .25, "ship_rig.tar-timber": 1, "ship_rig.warm-timber": 1,
    "ship_flag.pennant": .2, "ship_sail": .2,
}


def import_ship(path, ship):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    parts = []
    for obj in set(bpy.data.objects) - before:
        if obj.type != "MESH":
            continue
        obj.name = f"{ship}:{obj.name}"
        parts.append(obj)
    return parts


def part_key(obj):
    name = obj.name.split(":", 1)[1].split(".0", 1)[0]
    return "ship_sail" if name.startswith("ship_sail.") else name


def share_materials(parts, reference):
    """Points the second ship at the first ship's identical materials (all but the cloth)."""
    for obj in parts:
        for slot in obj.material_slots:
            base = slot.material.name.split(".")[0]
            if base in reference and not base.endswith("-cloth"):
                slot.material = reference[base]


def bake(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.select_set(False)


def fit_beam(parts):
    """Narrows the hull to CONTRACT_HALF_BEAM; custom normals follow the inverse-transpose scale."""
    hull = max(abs(v.co.x) for obj in parts if obj.name.endswith("ship_hull.tar-timber") for v in obj.data.vertices)
    narrow = min(1.0, CONTRACT_HALF_BEAM / hull)
    print(f"BEAM half {hull:.3f} -> scale {narrow:.3f}")
    low, high = BEAM_FADE
    factor = lambda z: narrow + (1 - narrow) * min(1.0, max(0.0, (z - low) / (high - low)))
    for obj in parts:
        mesh = obj.data
        normals = [Vector(n.vector) for n in mesh.corner_normals]
        heights = [mesh.vertices[loop.vertex_index].co.z for loop in mesh.loops]
        for vertex in mesh.vertices:
            vertex.co.x *= factor(vertex.co.z)
        fixed = [Vector((n.x / factor(z), n.y, n.z)).normalized() for n, z in zip(normals, heights)]
        mesh.normals_split_custom_set(fixed)
        mesh.update()


def copy_level(obj, ratio, level):
    dup = obj.copy()
    dup.data = obj.data.copy()
    dup.name = f"{obj.name}#{level}"
    bpy.context.scene.collection.objects.link(dup)
    bm = bmesh.new()
    bm.from_mesh(dup.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(dup.data)
    bm.free()
    if ratio < 1:
        modifier = dup.modifiers.new("decimate", "DECIMATE")
        modifier.ratio = ratio
        bpy.context.view_layer.objects.active = dup
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return dup


def join(objects, name):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = name
    joined.data.name = name
    return joined


def triangles(obj):
    return sum(len(polygon.vertices) - 2 for polygon in obj.data.polygons)


def deck_heights(objects):
    """Deck surface height (glTF y) along the centre line, for the shared deck floor."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    heights = {}
    for z in (-3.0, -2.0, -1.0, 1.0, 2.0, 3.0):
        hit = bpy.context.scene.ray_cast(depsgraph, Vector((0.6, -z, 20)), Vector((0, 0, -1)))
        heights[z] = round(hit[1].z, 3) if hit[0] else None
    return heights


def export(objects, path):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=True, export_extras=False)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    sources, out = argv[:2], argv[2]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ship_parts = {ship: import_ship(path, ship) for ship, path in zip(SHIPS, sources)}
    reference = {slot.material.name: slot.material for obj in ship_parts[SHIPS[0]]
                 for slot in obj.material_slots}
    share_materials(ship_parts[SHIPS[1]], reference)
    for parts in ship_parts.values():
        for obj in parts:
            bake(obj)
        fit_beam(parts)
    for obj in [o for o in bpy.data.objects if o.type != "MESH"]:
        bpy.data.objects.remove(obj)
    for ship, parts in ship_parts.items():
        for other, other_parts in ship_parts.items():
            for obj in other_parts:
                obj.hide_set(other != ship)
        print(f"DECK {ship} {deck_heights(parts)}")
    for obj in bpy.data.objects:
        obj.hide_set(False)
    levels = {"high": [], "minimal": []}
    for ship, parts in ship_parts.items():
        level_parts = [
            ("lod0", [copy_level(o, 1, "lod0") for o in parts]),
            ("lod1", [copy_level(o, MID_PARTS[part_key(o)], "lod1") for o in parts if part_key(o) in MID_PARTS]),
            ("lod2", [copy_level(o, FAR_PARTS[part_key(o)], "lod2") for o in parts if part_key(o) in FAR_PARTS]),
        ]
        for level, objects in level_parts:
            joined = join(objects, f"{ship.replace('-', '')}_{level}")
            print(f"LOD {joined.name} triangles={triangles(joined)} materials={len(joined.material_slots)}")
            levels["high"].append(joined)
            if level != "lod0":
                levels["minimal"].append(joined)
        for obj in parts:
            bpy.data.objects.remove(obj)
    export(levels["high"], f"{out}/pirate-ships-high.glb")
    export(levels["minimal"], f"{out}/pirate-ships-minimal.glb")


main()
