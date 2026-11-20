"""Repair supplied pagoda load paths without moving its original geometry or embedded PBR images.

Original japanese-{high,minimal}.glb remain byte-identical rollback sources. The processed siblings
add roof-following wall heads, timber soffits and the Minimal floors omitted by the supplied LOD.
Only standard-library binary glTF operations are used; no remeshing or image resampling occurs.
"""
import copy
import hashlib
import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
FOLDER = ROOT / "assets" / "monuments"
FORMATS = {5121: "B", 5123: "H", 5125: "I", 5126: "f"}
WIDTHS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
SOFFIT = .035


def load(path):
    source = path.read_bytes()
    size = struct.unpack_from("<I", source, 12)[0]
    document = json.loads(source[20:20 + size])
    offset = 20 + size
    binary_size = struct.unpack_from("<I", source, offset)[0]
    return source, document, bytearray(source[offset + 8:offset + 8 + binary_size])


def accessor(document, binary, index):
    item = document["accessors"][index]
    view = document["bufferViews"][item["bufferView"]]
    width, kind = WIDTHS[item["type"]], FORMATS[item["componentType"]]
    element = struct.calcsize(kind) * width
    offset = view.get("byteOffset", 0) + item.get("byteOffset", 0)
    return [struct.unpack_from("<" + kind * width, binary, offset + i * view.get("byteStride", element))
            for i in range(item["count"])]


def primitive(document, name):
    return next(mesh["primitives"][0] for mesh in document["meshes"] if mesh.get("name") == name)


class Geometry:
    def __init__(self):
        self.positions, self.normals, self.uv, self.indices = [], [], [], []

    def face(self, points, normal, uv=None):
        a = [points[1][i] - points[0][i] for i in range(3)]
        b = [points[2][i] - points[0][i] for i in range(3)]
        cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
        if sum(cross[i] * normal[i] for i in range(3)) < 0:
            points = list(reversed(points))
            if uv:
                uv = list(reversed(uv))
        start = len(self.positions)
        self.positions.extend(points)
        self.normals.extend([normal] * len(points))
        self.uv.extend(uv or [(i % 2, i // 2) for i in range(len(points))])
        for i in range(1, len(points) - 1):
            self.indices.extend([start, start + i, start + i + 1])


def roof_triangles(document, binary):
    part = primitive(document, "Roofs.tile")
    points = accessor(document, binary, part["attributes"]["POSITION"])
    normals = accessor(document, binary, part["attributes"]["NORMAL"])
    uv = accessor(document, binary, part["attributes"]["TEXCOORD_0"])
    indices = [item[0] for item in accessor(document, binary, part["indices"])]
    triangles = []
    for i in range(0, len(indices), 3):
        corners = indices[i:i + 3]
        triangle = [points[j] for j in corners]
        edges = [sum((triangle[a][k] - triangle[b][k]) ** 2 for k in range(3))
                 for a, b in ((0, 1), (1, 2), (2, 0))]
        # The material batch also contains narrow hip tubes. They are ornaments, not roof planes.
        if min(edges) < .06 ** 2:
            continue
        triangles.append((triangle, [normals[j] for j in corners], [uv[j] for j in corners]))
    return triangles


def section(triangle, nx, nz, distance):
    points = []
    for a, b in zip(triangle, triangle[1:] + triangle[:1]):
        da, db = a[0] * nx + a[2] * nz - distance, b[0] * nx + b[2] * nz - distance
        if abs(da) < 1e-7:
            points.append(a)
        if da * db < 0:
            share = da / (da - db)
            points.append(tuple(a[k] + (b[k] - a[k]) * share for k in range(3)))
    unique = list({tuple(round(value, 7) for value in point): point for point in points}.values())
    return unique[:2] if len(unique) >= 2 else None


def wall_heads(geometry, roofs, radius, bottom):
    apothem, half = radius * math.cos(math.pi / 8), radius * math.sin(math.pi / 8)
    for side in range(8):
        angle = side * math.pi / 4
        nx, nz, rx, rz = math.sin(angle), math.cos(angle), math.cos(angle), -math.sin(angle)
        seen = set()
        for triangle, _, _ in roofs:
            if min(p[1] for p in triangle) < bottom or max(p[1] for p in triangle) > bottom + .56:
                continue
            line = section(triangle, nx, nz, apothem)
            if not line:
                continue
            line.sort(key=lambda p: p[0] * rx + p[2] * rz)
            a, b = line
            lo, hi = a[0] * rx + a[2] * rz, b[0] * rx + b[2] * rz
            left, right = max(-half, lo), min(half, hi)
            if right - left < 1e-6:
                continue
            key = (round(left, 6), round(right, 6))
            if key in seen:
                continue
            seen.add(key)
            def upper(tangent):
                share = (tangent - lo) / (hi - lo)
                return a[1] + (b[1] - a[1]) * share - SOFFIT + .001
            yl, yr = upper(left), upper(right)
            if min(yl, yr) <= bottom:
                continue
            points = [(nx * apothem + rx * left, bottom - .002, nz * apothem + rz * left),
                      (nx * apothem + rx * right, bottom - .002, nz * apothem + rz * right),
                      (nx * apothem + rx * right, yr, nz * apothem + rz * right),
                      (nx * apothem + rx * left, yl, nz * apothem + rz * left)]
            geometry.face(points, (nx, 0, nz), [(left, 0), (right, 0), (right, yr - bottom), (left, yl - bottom)])


def floor(geometry, radius, y):
    lower = [(radius * math.sin((i + .5) * math.pi / 4), y - .04,
              radius * math.cos((i + .5) * math.pi / 4)) for i in range(8)]
    upper = [(x, y + .04, z) for x, _, z in lower]
    for i in range(8):
        j = (i + 1) % 8
        angle = (i + 1) * math.pi / 4
        geometry.face([lower[i], lower[j], upper[j], upper[i]], (math.sin(angle), 0, math.cos(angle)))
    geometry.face(list(reversed(lower)), (0, -1, 0))
    geometry.face(upper, (0, 1, 0))


def soffits(geometry, roofs):
    normals = [(math.sin(i * math.pi / 4), math.cos(i * math.pi / 4)) for i in range(8)]
    for points, vertex_normals, uv in roofs:
        centre_y = sum(point[1] for point in points) / 3
        level = next((i for i in range(11) if 1.93 + i * .785 + .71 <= centre_y < 1.93 + i * .785 + 1.12), None)
        radius = 2.69 if level is None else 1.77 - level * .071
        apothem = radius * math.cos(math.pi / 8) - .035
        if all(max(x * nx + z * nz for nx, nz in normals) < apothem for x, _, z in points):
            continue
        start = len(geometry.positions)
        order = [0, 2, 1]
        geometry.positions.extend([(points[i][0], points[i][1] - SOFFIT, points[i][2]) for i in order])
        geometry.normals.extend([tuple(-value for value in vertex_normals[i]) for i in order])
        geometry.uv.extend([uv[i] for i in order])
        geometry.indices.extend([start, start + 1, start + 2])


def roof_height(roofs, x, z):
    for points, _, _ in roofs:
        a, b, c = points
        denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2])
        if abs(denominator) < 1e-10:
            continue
        u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / denominator
        v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / denominator
        if min(u, v, 1 - u - v) < -1e-6:
            continue
        y = u * a[1] + v * b[1] + (1 - u - v) * c[1]
        if 1.6 < y < 2.4:
            return y - SOFFIT + .001
    raise ValueError(f"No hall roof over bearing {x},{z}")


def portico_bearings(geometry, roofs, quality):
    bottom = 1.625 if quality == "high" else 1.55
    for side in range(8):
        angle = (side + .5) * math.pi / 4
        x, z = 3.13 * math.sin(angle), 3.13 * math.cos(angle)
        corners = [(x + dx, z + dz) for dx, dz in [(-.09, -.09), (.09, -.09), (.09, .09), (-.09, .09)]]
        lower = [(px, bottom, pz) for px, pz in corners]
        upper = [(px, roof_height(roofs, px, pz), pz) for px, pz in corners]
        for i, normal in enumerate([(0, 0, -1), (1, 0, 0), (0, 0, 1), (-1, 0, 0)]):
            j = (i + 1) % 4
            geometry.face([lower[i], lower[j], upper[j], upper[i]], normal)
        geometry.face(upper, (0, 1, 0))
        geometry.face(list(reversed(lower)), (0, -1, 0))


def eave_joints(geometry):
    roofs = [(3.72, 1.65)] + [(2.41 - level * .104, 1.93 + level * .785 + .71) for level in range(11)]
    for radius, eave in roofs:
        for side in range(8):
            angle = (side - .5) * math.pi / 4
            x, z, y = radius * math.sin(angle), radius * math.cos(angle), eave + .18
            # Each adjacent uncapped diamond tube has a different horizontal normal at the joint.
            # Their common upper/lower tips and outer corners bound the missing miter wedge.
            a, b = angle - math.pi / 8, angle + math.pi / 8
            left = (x + .034 * math.sin(a), y, z + .034 * math.cos(a))
            right = (x + .034 * math.sin(b), y, z + .034 * math.cos(b))
            normal = (math.sin(angle), 0, math.cos(angle))
            geometry.face([left, (x, y + .034, z), right], normal)
            geometry.face([left, right, (x, y - .034, z)], normal)


def append_mesh(document, binary, name, geometry):
    part = primitive(document, name)
    original = {key: accessor(document, binary, value) for key, value in part["attributes"].items()}
    old_indices = [item[0] for item in accessor(document, binary, part["indices"])]
    offset = len(original["POSITION"])
    arrays = {"POSITION": original["POSITION"] + geometry.positions,
              "NORMAL": original["NORMAL"] + geometry.normals,
              "TEXCOORD_0": original["TEXCOORD_0"] + geometry.uv}
    def store(values, width, kind):
        while len(binary) % 4:
            binary.append(0)
        start = len(binary)
        for value in values:
            binary.extend(struct.pack("<" + kind * width, *value))
        view = len(document["bufferViews"])
        document["bufferViews"].append({"buffer": 0, "byteOffset": start, "byteLength": len(binary) - start})
        item = {"bufferView": view, "componentType": 5126 if kind == "f" else 5125,
                "count": len(values), "type": {1: "SCALAR", 2: "VEC2", 3: "VEC3"}[width]}
        if width == 3:
            item.update(min=[min(v[i] for v in values) for i in range(3)], max=[max(v[i] for v in values) for i in range(3)])
        document["accessors"].append(item)
        return len(document["accessors"]) - 1
    for key, values in arrays.items():
        part["attributes"][key] = store(values, len(values[0]), "f")
    indices = old_indices + [index + offset for index in geometry.indices]
    part["indices"] = store([(index,) for index in indices], 1, "I")


def build(quality):
    source, document, binary = load(FOLDER / f"japanese-{quality}.glb")
    document = copy.deepcopy(document)
    roofs = roof_triangles(document, binary)
    walls, timber, bearings, joints = Geometry(), Geometry(), Geometry(), Geometry()
    wall_heads(walls, roofs, 2.69, 1.565)
    for level in range(11):
        y, radius = 1.93 + level * .785, 1.77 - level * .071
        wall_heads(walls, roofs, radius, y + .59)
        if quality == "minimal":
            floor(timber, radius + .075, y + .02)
    soffits(timber, roofs)
    portico_bearings(bearings, roofs, quality)
    eave_joints(joints)
    append_mesh(document, binary, "Architecture.carved", bearings)
    append_mesh(document, binary, "Architecture.vermilion", walls)
    append_mesh(document, binary, "Roofs.oak", timber)
    append_mesh(document, binary, "Roofs.cream", joints)
    document["buffers"][0]["byteLength"] = len(binary)
    document.setdefault("asset", {}).setdefault("extras", {})["continuityRepair"] = "2026-10-31: continuous wall heads, roof soffits and Minimal floor diaphragms"
    encoded = json.dumps(document, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    binary += b"\0" * (-len(binary) % 4)
    result = struct.pack("<III", 0x46546C67, 2, 28 + len(encoded) + len(binary))
    result += struct.pack("<II", len(encoded), 0x4E4F534A) + encoded
    result += struct.pack("<II", len(binary), 0x004E4942) + binary
    path = FOLDER / f"japanese-continuous-{quality}.glb"
    path.write_bytes(result)
    return {"quality": quality, "file": path.name, "source": f"japanese-{quality}.glb",
            "sourceSha256": hashlib.sha256(source).hexdigest(), "sha256": hashlib.sha256(result).hexdigest(),
            "addedWallTriangles": len(walls.indices) // 3, "addedTimberTriangles": len(timber.indices) // 3,
            "addedBearingTriangles": len(bearings.indices) // 3,
            "addedEaveJointTriangles": len(joints.indices) // 3,
            "triangles": sum(document["accessors"][p["indices"]]["count"] // 3 for mesh in document["meshes"] for p in mesh["primitives"]),
            "bytes": len(result), "originalMeshAndTextureGroupsRetained": True}


if __name__ == "__main__":
    reports = [build(quality) for quality in ("high", "minimal")]
    (FOLDER / "japanese-continuity.json").write_text(json.dumps({"reports": reports}, indent=2) + "\n")
    print(json.dumps(reports, indent=2))
