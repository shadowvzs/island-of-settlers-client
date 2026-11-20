"""Offline mesh derivation accounting, not gameplay/visual acceptance."""
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
text = (ROOT / 'src/render-common/wares/advanced-material-source-data.ts').read_text()
data = json.loads(text.split(' = ', 1)[1].rstrip().removesuffix(';'))
report = {'scope': 'Offline finite attributes, derived triangle counts and source provenance; native review still required', 'wares': {}, 'marble': []}
for key in ('logs', 'planks'):
    chunks = data[key]['chunks']
    report['wares'][key] = {'highTriangles': sum(len(c['position']) // 9 for c in chunks),
        'minimalTriangles': sum(len(c.get('minimalPosition', c['position'])) // 9 for c in chunks),
        'drawsPerModel': len(data[key]['materials']), 'sourceSha256': data[key]['sha256']}
    assert all(math.isfinite(v) for c in chunks for k in ('position', 'uv') for v in c[k])
pieces = []
for index, chunk in enumerate(data['deposit']['chunks']):
    axes = [chunk['position'][axis::3] for axis in range(3)]
    volume = math.prod(max(values) - min(values) for values in axes)
    pieces.append({'chunk': chunk, 'index': index, 'minimum': min(axes[1]), 'volume': volume})
all_values = [value for chunk in data['deposit']['chunks'] for value in chunk['position']]
minimum = min(all_values[1::3]); height = max(all_values[1::3]) - minimum
radius = max(math.hypot(all_values[at], all_values[at+2]) for at in range(0, len(all_values), 3))
for detailed in (True, False):
    for variant in range(3):
        for state, factor in enumerate((1, .62, .24, .025)):
            selected = sorted(pieces, key=lambda p: (-p['volume'], p['index']))[:50 if detailed else 28]
            if state == 3:
                selected = sorted([p for p in pieces if p['volume'] < .03], key=lambda p: (p['minimum'], p['index']))[:8 if detailed else 4]
            if not selected:
                selected = sorted(pieces, key=lambda p: p['volume'])[:4]
            vertices = []
            for piece in selected:
                positions = piece['chunk']['position']
                for at in range(0, len(positions), 9):
                    tri = []
                    for start in (at, at+3, at+6):
                        x,y,z = positions[start:start+3]
                        x *= .78/radius * (.8,.9,1)[variant]
                        z *= .78/radius * (.85 if variant == 1 else 1)
                        y = min(max(0,y-minimum),factor*height)*.78/radius
                        yaw = (.25,1.3,2.35)[variant]
                        tri.append((math.cos(yaw)*x+math.sin(yaw)*z,y,-math.sin(yaw)*x+math.cos(yaw)*z))
                    a,b,c = tri
                    u,v = [b[i]-a[i] for i in range(3)],[c[i]-a[i] for i in range(3)]
                    if math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]) < 1e-9: continue
                    vertices.extend(tri)
            assert vertices and all(math.isfinite(v) for p in vertices for v in p)
            maximum_radius = max(math.hypot(p[0],p[2]) for p in vertices)
            assert maximum_radius <= .780001
            report['marble'].append({'quality':'high' if detailed else 'minimal','variant':variant,'state':state,
                'triangles':len(vertices)//3,'draws':1,'radius':round(maximum_radius,6),
                'height':round(max(p[1] for p in vertices),6)})
output = ROOT.parent.parent / 'resources/settlement-previews/advanced-material-assets'
output.mkdir(parents=True, exist_ok=True)
(output / 'offline-budget.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report['wares']))
print('marble High maximum',max(r['triangles'] for r in report['marble'] if r['quality']=='high'))
print('marble Minimal maximum',max(r['triangles'] for r in report['marble'] if r['quality']=='minimal'))
print(output / 'offline-budget.json')
