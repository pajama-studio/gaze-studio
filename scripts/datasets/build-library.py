"""Inventory all source data used by this project. Files remain private unless explicitly allowlisted for replay."""
from pathlib import Path
import json,hashlib,mimetypes,time
root=Path('.');out=Path('artifacts/library');out.mkdir(exist_ok=True);datasets=[]
def dataset(id,title,description,url,license,public=False,manifest=None):
 d=dict(id=id,title=title,description=description,sourceUrl=url,license=license,revision='v1',public=public,manifestKey=manifest,assets=[]);datasets.append(d);return d
def asset(d,file,path,role='raw',public=False):
 f=Path(file)
 if not f.is_file():return
 d['assets'].append(dict(file=str(f),path=path,key=f"datasets/{d['id']}/v1/{path}",role=role,public=public,bytes=f.stat().st_size,sha256=hashlib.file_digest(f.open('rb'),'sha256').hexdigest(),mime=mimetypes.guess_type(f)[0] or 'application/octet-stream'))
em=dataset('emotion-p01-0a','Through both eyes','P01 / 0a · real binocular eye cameras, VR scene, gaze and pupil signals. 20-second derivative replay; complete selected trial sources archived.','https://zenodo.org/records/16794721','CC BY 4.0 dataset; third-party film stimulus retains its rights.',True,'datasets/emotion-p01-0a/v1/recording.json')
for f in Path('artifacts/research/emotion/P01-0a').glob('*'):
 if f.suffix in ['.mp4','.csv','.json']:asset(em,f,'raw/'+f.name)
for f in Path('artifacts/research/emotion').glob('*.json'):asset(em,f,'provenance/'+f.name,'provenance')
for f in Path('artifacts/library/emotion-p01-0a/v1').glob('*'):
 asset(em,f,f.name,'replay' if f.suffix=='.mp4' else 'metadata',True)
for f in Path('artifacts/library/emotion-p01-0a/annotation').glob('*'):asset(em,f,'annotation/'+f.name,'annotation')
h=dataset('harmonic-p122-011','HARMONIC P122 / 011','Official sample with both eye cameras, world video, capture timestamps and robot signals. Stored privately pending explicit redistribution terms.','https://harplab.github.io/harmonic/','Public research download; no explicit dataset redistribution license located.')
f=Path('artifacts/research/harmonic/sample.tar.gz');chunks=out/'harmonic-p122-011/source';chunks.mkdir(parents=True,exist_ok=True)
if f.exists():
 # Wrangler's upload endpoint allows 300 MiB; immutable 128 MiB chunks preserve the exact 303 MiB archive.
 parts=[]
 with f.open('rb') as src:
  i=0
  while b:=src.read(128*1024*1024):
   name=f'sample.tar.gz.part-{i:03d}';dst=chunks/name
   if not dst.exists() or dst.stat().st_size!=len(b):dst.write_bytes(b)
   asset(h,dst,'raw/'+name,'archive-part');parts.append({'path':'raw/'+name,'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)});i+=1
 archive=dict(name='harmonic_1.0.0_sample.tar.gz',archiveRoot='harmonic_0.5.0',url='https://drive.google.com/file/d/1P1JQfusBfeazZd11FDwuHXPc8pEF-vYs/view',sha256=hashlib.file_digest(f.open('rb'),'sha256').hexdigest(),bytes=f.stat().st_size,parts=parts,reassemble='Concatenate parts in numeric order, then verify the archive SHA-256 before extracting.')
 a=chunks/'archive.json';a.write_text(json.dumps(archive,indent=2));asset(h,a,'raw/archive.json','provenance')
for f in Path('artifacts/research/harmonic/extracted').glob('*'):
 if f.name in ['eye0.mp4','eye1.mp4','world.mp4','eye0_timestamps.npy','eye1_timestamps.npy','world_timestamps.npy','gaze_positions.csv','pupil_eye0.csv','pupil_eye1.csv','run_info.yaml']:asset(h,f,'trial/'+f.name)
for f in Path('artifacts/library/harmonic-p122-011/replay').glob('*'):asset(h,f,'replay/'+f.name,'replay')
g=dataset('gazemining-amazon','GazeMining Amazon','Original participant 1 browser task, gaze, frame clocks and DOM source. No eye-camera imagery.','https://zenodo.org/records/5031618','CC0 as declared by source; third-party website content retains its rights.',True)
for f in Path('artifacts/gazemining').glob('*'):asset(g,f,'raw/'+f.name)
for f in Path('public/datasets').glob('*'):
 if 'gazemining' in f.name:asset(g,f,'replay/'+f.name,'replay',True)
c=dataset('gazecom','GazeCom annotations','Downloaded public annotations archive used to validate ARFF import and event-analysis planning. Original stimulus videos were unavailable.','https://michaeldorr.de/smoothpursuit/','Repository GPL; original dataset and media terms remain separate.')
asset(c,'artifacts/GazeCom.zip','raw/GazeCom.zip','archive')
v=dataset('studio-verification','Studio verification','Reproducible analysis results, benchmark fixtures and verification reports. Synthetic and real-data outputs are labeled separately.','https://github.com/pajama-studio/gaze-studio','MIT project output; underlying dataset terms continue to apply.')
for directory in ['artifacts/verification','artifacts/benchmark','artifacts/cli','docs/verification']:
 for f in Path(directory).glob('*.json'):asset(v,f,directory.replace('/','-')+'/'+f.name,'analysis')
plan={'format':'gaze-library','version':'0.1.0','created':int(time.time()*1000),'datasets':datasets}
(out/'upload-plan.json').write_text(json.dumps(plan,indent=2));print('Datasets',len(datasets),'objects',sum(len(d['assets']) for d in datasets),'bytes',sum(a['bytes'] for d in datasets for a in d['assets']))
