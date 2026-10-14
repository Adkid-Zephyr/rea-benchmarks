from pathlib import Path
import json,hashlib,re
import numpy as np
from PIL import Image
R=Path(__file__).resolve().parents[1];C=R/'benchmarks/001-webgl-fluid'
def require(ok,message):
 if not ok:raise AssertionError(message)
for name,digest in json.loads((R/'SHA256SUMS.json').read_text()).items():require(hashlib.sha256((R/name).read_bytes()).hexdigest()==digest,'Integrity mismatch: '+name)
for item in json.loads((C/'evidence/source-manifest.json').read_text()):
 p=C/'reference'/item['file']
 if p.exists():require(hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256'],'Source mismatch')
for row in json.loads((C/'evidence/metrics.json').read_text()):
 m=row['model'];a=C/'runs'/m/'engine.js';require(hashlib.sha256(a.read_bytes()).hexdigest()==row['engine_sha256'],m+' engine mismatch');require(a.read_bytes()==(C/'web/models'/m/'engine.js').read_bytes(),m+' viewer copy mismatch')
 for metric in row['metrics']:
  name=f"{metric['frame']:03d}.png";scene=metric['scene'];base=C/'web/snapshots'
  ref=np.array(Image.open(base/'reference'/scene/name).convert('RGB'),dtype=float);out=np.array(Image.open(base/m/scene/name).convert('RGB'),dtype=float)
  mae=float(np.abs(ref-out).mean());require(abs(mae-metric['mae_rgb_255'])<1e-9,f'{m}/{scene}/{name} MAE mismatch')
 records=[json.loads(x) for x in (C/'runs'/m/'audit.jsonl').read_text().splitlines()]
 writes=[x for x in records if x['type']=='tool_result' and x['name']=='write_engine' and 'saved_bytes' in x['result']];require(len(writes)==row['writes'],'write count mismatch')
 for x in records:
  for call in x.get('tool_calls',[]):
   if call['name']=='write_engine':
    arg=call['arguments'];require(hashlib.sha256((C/'runs'/m/arg['revision']).read_bytes()).hexdigest()==arg['sha256'],'revision mismatch')
 print(m,': 10 screenshot metrics, output identity and audit passed')
for p in R.rglob('*'):
 if not p.is_file() or any(x in p.parts for x in ['.git','node_modules','.venv','__pycache__','local-runs']):continue
 if p.suffix not in ['.json','.jsonl','.md','.py','.cjs','.js','.html','.txt','.yml']:continue
 s=p.read_text()
 require(not re.search(r'/' + r'Users/[^/]+/|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{24,}',s),'Potential private data: '+str(p))
 if p.name=='audit.jsonl':require(not any(k in s for k in ['"reasoning_content"','"thinking"']),'Internal reasoning in audit')
print('PASS: integrity, 30 frame metrics, source identity, revisions and publication hygiene. No model calls made.')
