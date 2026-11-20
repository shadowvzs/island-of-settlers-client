"""Run the actual client lift probe on the published roster; no rendered images are retained.
Usage: python3 tools/bench/codex-fisher-roster-check.py --arms
Run from the client repository. Each gate measures81poses; --representative selects16bodies.
"""
import argparse, concurrent.futures, hashlib, json, pathlib, subprocess, sys
parser=argparse.ArgumentParser()
parser.add_argument('--arms',action='store_true')
parser.add_argument('--representative',action='store_true')
parser.add_argument('--workers',type=int,default=2)
parser.add_argument('--variant')
args=parser.parse_args()
source=pathlib.Path('../island-of-settlers-worker-generation/src/tripo-roster.ts').read_text()
roster=json.loads(source[source.index('{'):source.rindex('}')+1])
jobs=[(nation,variant,yard) for nation,sexes in roster.items() for variants in sexes.values()
      for variant in (variants[:1] if args.representative else variants) if not args.variant or args.variant==variant for yard in [False,True]]
folder=pathlib.Path('/tmp/codex-fisher-boat/roster-arms' if args.arms else '/tmp/codex-fisher-boat/roster-full');folder.mkdir(exist_ok=True)
files=['src/renderers/three/'+name+'.ts' for name in ['worker-boat-elbow-clearance','worker-boat-grip-orientation','worker-boat-transfer','worker-boat-lift-path','worker-boat-head-clearance','worker-boat-hand-contacts','three-worker-prop','three-worker']]
files+=['src/render-common/ships/fishing-skiff-yard.ts','src/render-common/ships/fishing-skiff-dimensions.ts']
def hashes():return {p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() for p in files}
before=hashes()
def run(job):
 nation,variant,yard=job
 cmd=['node','node_modules/tsx/dist/cli.mjs','tools/bench/codex-fisher-dense-probe.ts',nation,variant,'--surface','--measure-only','--gate']+(['--yard'] if yard else [])+(['--arms'] if args.arms else [])
 p=subprocess.run(cmd,capture_output=True,text=True)
 gate=pathlib.Path('/tmp/codex-fisher-boat/dense-probe')/('yard' if yard else '')/('arms' if args.arms else '')/(variant+'-gate.json')
 result={'nation':nation,'variant':variant,'yard':yard,'exit':p.returncode,'gate':json.loads(gate.read_text()) if gate.exists() else None}
 (folder/(variant+('-yard' if yard else '-ground')+'.log')).write_text(p.stdout+p.stderr)
 print(json.dumps({'variant':variant,'yard':yard,'exit':p.returncode,'failures':len((result['gate']or{}).get('failures',[]))}),flush=True)
 return result
with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:results=list(pool.map(run,jobs))
report={'sourceHashes':before,'sourceUnchanged':before==hashes(),'includeArms':args.arms,'results':results}
(folder/'roster-gate.json').write_text(json.dumps(report,indent=2))
sys.exit(0 if report['sourceUnchanged'] and all(r['exit']==0 for r in results) else 1)
