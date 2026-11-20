#!/usr/bin/env python3
"""Build the biome-grass prop-mesh payload from the owner's 72 source GLBs.

The GLBs are authored in world units (one tile), Y up, with COLOR_0.a as the wind weight.
The game's prop path takes vertex-coloured, untextured cover meshes, so every vertex bakes
its atlas sample into COLOR_0.rgb and keeps COLOR_0.a as the wind weight. High and min share
one bounds-quantised runtime payload; hero has its own payload for close-up icons and later
passes, so an ordinary island never downloads the hero geometry.

Usage:
  python3 tools/assets/biome-grass-payload.py --source ~/Downloads/models/biome-grass
"""

import argparse
import gzip
import hashlib
import io
import json
import struct
from pathlib import Path

from PIL import Image

BIOMES = ("savanna", "jungle", "forest")
LODS = ("high", "min", "hero")
VERTEX_BYTES = 16
COMPONENT_BYTES = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
COMPONENT_FORMAT = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
TYPE_WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(path):
    data = path.read_bytes()
    length = struct.unpack_from("<I", data, 8)[0]
    offset = 12
    chunks = []
    while offset < length:
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        chunks.append((chunk_type, data[offset + 8:offset + 8 + chunk_length]))
        offset += 8 + chunk_length
    json_chunk = next(chunk for kind, chunk in chunks if kind == 0x4E4F534A)
    binary_chunk = next(chunk for kind, chunk in chunks if kind == 0x004E4942)
    return json.loads(json_chunk), binary_chunk


def read_accessor(gltf, binary, accessor_id):
    accessor = gltf["accessors"][accessor_id]
    view = gltf["bufferViews"][accessor["bufferView"]]
    width = TYPE_WIDTH[accessor["type"]]
    fmt = COMPONENT_FORMAT[accessor["componentType"]]
    item_bytes = COMPONENT_BYTES[accessor["componentType"]] * width
    stride = view.get("byteStride", item_bytes)
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    values = []
    for index in range(accessor["count"]):
        base = start + index * stride
        values.append(struct.unpack_from("<" + fmt * width, binary, base))
    return values


def read_atlas(gltf, binary):
    material = gltf["materials"][0]
    texture = material["pbrMetallicRoughness"]["baseColorTexture"]
    image_id = gltf["textures"][texture["index"]]["source"]
    image = gltf["images"][image_id]
    view = gltf["bufferViews"][image["bufferView"]]
    start = view.get("byteOffset", 0)
    payload = binary[start:start + view["byteLength"]]
    return Image.open(io.BytesIO(payload)).convert("RGB")


def sample_atlas(atlas, uv):
    width, height = atlas.size
    x = min(width - 1, max(0, int(uv[0] * width)))
    y = min(height - 1, max(0, int(uv[1] * height)))
    return atlas.getpixel((x, y))


def load_lod(path):
    gltf, binary = read_glb(path)
    primitive = gltf["meshes"][0]["primitives"][0]
    positions = read_accessor(gltf, binary, primitive["attributes"]["POSITION"])
    normals = read_accessor(gltf, binary, primitive["attributes"]["NORMAL"])
    uvs = read_accessor(gltf, binary, primitive["attributes"]["TEXCOORD_0"])
    colors = read_accessor(gltf, binary, primitive["attributes"]["COLOR_0"])
    indices = [value[0] for value in read_accessor(gltf, binary, primitive["indices"])]
    atlas = read_atlas(gltf, binary)
    vertices = []
    for index, position in enumerate(positions):
        atlas_rgb = sample_atlas(atlas, uvs[index])
        color = colors[index]
        alpha = color[3] if len(color) == 4 else 1.0
        vertices.append({
            "position": position,
            "normal": normals[index],
            "color": [min(1.0, atlas_rgb[channel] / 255.0 * color[channel]) for channel in range(3)],
            "wind": min(1.0, max(0.0, alpha)),
        })
    height = max(vertex["position"][1] for vertex in vertices)
    radius = max((vertex["position"][0] ** 2 + vertex["position"][2] ** 2) ** 0.5 for vertex in vertices)
    return {"vertices": vertices, "indices": indices, "height": height, "radius": radius}


def quantise(value, low, high):
    if high - low <= 1e-9:
        return 0
    return min(65535, max(0, round((value - low) / (high - low) * 65535)))


def write_vertex_block(vertices, bounds):
    low, high = bounds
    block = bytearray()
    for vertex in vertices:
        position = [quantise(vertex["position"][axis], low[axis], high[axis]) for axis in range(3)]
        normal = [min(32767, max(-32767, round(vertex["normal"][axis] * 32767))) for axis in range(3)]
        color = [min(255, max(0, round(channel * 255))) for channel in vertex["color"]]
        wind = min(255, max(0, round(vertex["wind"] * 255)))
        block += struct.pack("<HHHhhhBBBB", *position, *normal, *color, wind)
    return bytes(block)


def write_index_block(indices):
    return struct.pack("<" + "H" * len(indices), *indices)


def variant_bounds(lods):
    points = [vertex["position"] for lod in lods.values() if lod for vertex in lod["vertices"]]
    low = [min(point[axis] for point in points) for axis in range(3)]
    high = [max(point[axis] for point in points) for axis in range(3)]
    return low, high


def build_variant(source, biome, variant, payloads, meta):
    lods = {lod: load_lod(source / f"{biome}-v{variant}-{lod}.glb") for lod in LODS}
    bounds = variant_bounds(lods)
    blocks = {}
    for lod in LODS:
        payload_name = "hero" if lod == "hero" else "runtime"
        payload = payloads[payload_name]
        lod_data = lods[lod]
        vertices = write_vertex_block(lod_data["vertices"], bounds)
        indices = write_index_block(lod_data["indices"])
        vertex_offset = len(payload)
        payload += vertices
        index_offset = len(payload)
        payload += indices
        blocks[lod] = {
            "payload": payload_name,
            "vertices": {"offset": vertex_offset, "length": len(vertices)},
            "indices": {"offset": index_offset, "length": len(indices)},
            "triangles": len(lod_data["indices"]) // 3,
        }
    meta["variants"].append({
        "variant": variant,
        "height": round(lods["high"]["height"], 5),
        "radius": round(max(lod["radius"] for lod in lods.values()), 5),
        "min": [round(value, 6) for value in bounds[0]],
        "max": [round(value, 6) for value in bounds[1]],
        "lods": blocks,
    })


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[2]
                        / "src/render-common/props/plants")
    args = parser.parse_args()
    source = args.source.expanduser()
    payloads = {"hero": bytearray(), "runtime": bytearray()}
    meta = {"version": 1, "vertexBytes": VERTEX_BYTES, "kinds": {}}
    for biome in BIOMES:
        meta["kinds"][biome] = {"variants": []}
        for variant in range(1, 9):
            build_variant(source, biome, variant, payloads, meta["kinds"][biome])
    args.output.mkdir(parents=True, exist_ok=True)
    for name, payload in payloads.items():
        compressed = gzip.compress(bytes(payload), compresslevel=9, mtime=0)
        suffix = "" if name == "runtime" else "-hero"
        (args.output / f"biome-grass{suffix}-data.gz.bin").write_bytes(compressed)
        meta[f"{name}Bytes"] = len(payload)
        meta[f"{name}Sha256"] = hashlib.sha256(bytes(payload)).hexdigest()
        print(f"{name} payload {len(payload)} bytes, gzip {len(compressed)} bytes")
    (args.output / "biome-grass-meta.json").write_text(
        json.dumps(meta, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8")
    triangles = {biome: sum(variant["lods"]["high"]["triangles"] for variant in data["variants"])
                 for biome, data in meta["kinds"].items()}
    print("high triangles per 8 variants", triangles)


if __name__ == "__main__":
    main()
