"""Deterministic geometry/texture extraction from the owner's approved GLBs; no source scripts run."""
import hashlib
import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT.parent.parent / 'resources/hardwood-marble-glb-pack-v2/models'
OUT = ROOT / 'assets/models/materials'
COMPONENTS = {5121: ('B', 1), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
WIDTHS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def unpack(path):
    data = path.read_bytes()
    magic, version, size = struct.unpack_from('<III', data)
    assert magic == 0x46546C67 and version == 2 and size == len(data)
    count = struct.unpack_from('<I', data, 12)[0]
    document = json.loads(data[20:20 + count])
    binary = data[28 + count:]
    # Current handoff meshes have baked transforms. Fail rather than silently discarding future transforms.
    assert all(not any(key in node for key in ('matrix', 'translation', 'rotation', 'scale'))
               for node in document['nodes'])

    def accessor(index):
        field = document['accessors'][index]
        view = document['bufferViews'][field['bufferView']]
        code, size = COMPONENTS[field['componentType']]
        width = WIDTHS[field['type']]
        offset = view.get('byteOffset', 0) + field.get('byteOffset', 0)
        stride = view.get('byteStride', size * width)
        return [struct.unpack_from('<' + code * width, binary, offset + row * stride)
                for row in range(field['count'])]

    images = []
    for image in document['images']:
        view = document['bufferViews'][image['bufferView']]
        content = binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']]
        name = hashlib.sha256(content).hexdigest()[:16] + '.png'
        (OUT / name).write_bytes(content)
        images.append(name)
    materials = []
    for material in document['materials']:
        pbr = material['pbrMetallicRoughness']
        image = document['textures'][pbr['baseColorTexture']['index']]['source']
        materials.append({'texture': images[image], 'color': pbr.get('baseColorFactor', [1, 1, 1, 1])[:3],
                          'roughness': pbr.get('roughnessFactor', 1)})
    chunks = []
    for mesh in document['meshes']:
        for primitive in mesh['primitives']:
            assert primitive.get('mode', 4) == 4
            vertices = accessor(primitive['attributes']['POSITION'])
            uv = accessor(primitive['attributes']['TEXCOORD_0'])
            indices = [value[0] for value in accessor(primitive['indices'])]
            chunks.append({'material': primitive['material'],
                           'position': [round(value, 6) for index in indices for value in vertices[index]],
                           'uv': [round(value, 6) for index in indices for value in uv[index]]})
    if path.name.startswith('hardwood-log'):
        for base in range(0, 9, 3):
            caps = [chunks[base + offset]['position'] for offset in (1, 2)]
            centres = [[sum(cap[axis::3]) / (len(cap) // 3) for axis in range(3)] for cap in caps]
            origin = centres[0]
            direction = [centres[1][i] - origin[i] for i in range(3)]
            length = math.sqrt(sum(v*v for v in direction)); direction = [v/length for v in direction]
            radial = [caps[0][i] - origin[i] for i in range(3)]
            along = sum(radial[i] * direction[i] for i in range(3))
            radial = [radial[i] - along * direction[i] for i in range(3)]
            size = math.sqrt(sum(v*v for v in radial))
            # The first cap vertex can be its centre; use a non-central perimeter vertex.
            if size < .001:
                radial = [caps[0][3+i]-origin[i] for i in range(3)]
                along = sum(radial[i]*direction[i] for i in range(3))
                radial = [radial[i]-along*direction[i] for i in range(3)]
                size = math.sqrt(sum(v*v for v in radial))
            axis_x = [v/size for v in radial]
            axis_y = [direction[1]*axis_x[2]-direction[2]*axis_x[1],
                      direction[2]*axis_x[0]-direction[0]*axis_x[2],
                      direction[0]*axis_x[1]-direction[1]*axis_x[0]]
            radius = max(math.sqrt(sum((cap[at+i]-centre[i])**2 for i in range(3)))
                         for cap,centre in zip(caps,centres) for at in range(0,len(cap),3))
            # Source side indices contain long crossed fans. Rebuild closed rings instead of
            # preserving corrupt topology; retain measured axes, cap centres, bark/endgrain materials.
            for segments, prefix in ((48, ''), (6, 'minimal')):
                side_position, side_uv = [], []
                cap_positions, cap_uvs = [[], []], [[], []]
                def ring(end, angle):
                    return [centres[end][i] + radius * (math.cos(angle)*axis_x[i] + math.sin(angle)*axis_y[i])
                            for i in range(3)]
                def triangle(positions, coordinates, vertices, texcoords):
                    positions.extend(round(value, 6) for point in vertices for value in point)
                    coordinates.extend(round(value, 6) for point in texcoords for value in point)
                for segment in range(segments):
                    angle, next_angle = 2*math.pi*segment/segments, 2*math.pi*(segment+1)/segments
                    front, next_front = ring(0, angle), ring(0, next_angle)
                    back, next_back = ring(1, angle), ring(1, next_angle)
                    u, next_u = segment/segments, (segment+1)/segments
                    triangle(side_position,side_uv,[front,next_front,back],[(u,0),(next_u,0),(u,1)])
                    triangle(side_position,side_uv,[next_front,next_back,back],[(next_u,0),(next_u,1),(u,1)])
                    uv = (.5+.5*math.cos(angle),.5+.5*math.sin(angle))
                    next_uv = (.5+.5*math.cos(next_angle),.5+.5*math.sin(next_angle))
                    triangle(cap_positions[0],cap_uvs[0],[centres[0],next_front,front],[(.5,.5),next_uv,uv])
                    triangle(cap_positions[1],cap_uvs[1],[centres[1],back,next_back],[(.5,.5),uv,next_uv])
                position_key, uv_key = ('position','uv') if not prefix else ('minimalPosition','minimalUv')
                chunks[base][position_key], chunks[base][uv_key] = side_position, side_uv
                for end in range(2):
                    chunks[base+1+end][position_key] = cap_positions[end]
                    chunks[base+1+end][uv_key] = cap_uvs[end]
    return {'source': path.name, 'sha256': hashlib.sha256(data).hexdigest(), 'materials': materials, 'chunks': chunks}


OUT.mkdir(parents=True, exist_ok=True)
models = {key: unpack(SOURCE / filename) for key, filename in (
    ('deposit', 'marble-deposit-v2.glb'), ('logs', 'hardwood-log-bundle-v2.glb'),
    ('planks', 'hardwood-plank-bundle-v2.glb'))}
output = ROOT / 'src/render-common/wares/advanced-material-source-data.ts'
output.write_text('// Generated by tools/assets/import-advanced-materials.py from owner-supplied GLBs.\n' +
                  'export const ADVANCED_MATERIAL_SOURCE_DATA = ' + json.dumps(models, separators=(',', ':')) + ';\n')
for key, model in models.items():
    print(key, sum(len(chunk['position']) // 9 for chunk in model['chunks']), 'triangles', len(model['materials']), 'materials')
