"""Convert the public p1 Amazon recording. Keep the original gaze stream as a separate artifact."""
import pathlib,json,hashlib,gzip,shutil,subprocess,collections,statistics
root=pathlib.Path(__file__).resolve().parents[1]; src=root/'artifacts/gazemining'; dest=root/'public/datasets';dest.mkdir(exist_ok=True)
j=json.loads((src/'amazon.json').read_text()); groups=collections.defaultdict(list)
for s in j['Gaze']:groups[s['qtVideoTs']].append(s)
samples=[]
for t,rows in sorted(groups.items()):
    valid=[s for s in rows if s['leftX'] is not None and s['leftY'] is not None]
    # Upstream Parser.cpp uses LEFT eye viewport coordinates without subtracting desktop origin.
    # Qt receipt timestamps can duplicate; aggregate within identical ms without inventing sub-ms timing.
    samples.append({'t':round(t*1000),'x':statistics.mean(s['leftX'] for s in valid) if valid else None,'y':statistics.mean(s['leftY'] for s in valid) if valid else None,'valid':bool(valid),'participant':'P01'})
frames=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',str(src/'amazon.webm')]))['frames']
pts=[round(float(f['best_effort_timestamp_time'])*1e6) for f in frames]
supplied=[round(float(line)*1e6) for line in (src/'amazon_times.csv').read_text().splitlines() if line.strip()]
assert pts==supplied, 'Supplied frame times do not equal decoded media PTS'
shutil.copyfile(src/'amazon.webm',dest/'gazemining-amazon.webm')
raw=gzip.compress((src/'amazon.json').read_bytes(),mtime=0);(dest/'gazemining-amazon-raw.json.gz').write_bytes(raw)
shutil.copyfile(src/'README.txt',dest/'GazeMining-README.txt')
# Manually authored example viewport AOIs are explicitly our annotations, not dataset ground truth.
aois=[{'id':'viewport-left','name':'Left viewport','shape':'rectangle','color':'#0c9a87','start':0,'end':78000000,'keyframes':[{'t':0,'points':[[0,0],[512,768]]}],'source':'manual','accepted':True},{'id':'viewport-right','name':'Right viewport','shape':'rectangle','color':'#d59e3f','start':0,'end':78000000,'keyframes':[{'t':0,'points':[[512,0],[1024,768]]}],'source':'manual','accepted':True}]
record={'id':'gazemining-p1-amazon','recordedEye':'left','title':'A shopping session, observed','description':'GazeMining · Participant 01 · Amazon browsing · Real Tobii recording, with frame timestamps.','width':1024,'height':768,'duration':78000000,'mediaType':'video','mediaName':'amazon.webm','mediaUrl':'/api/examples/gazemining','samples':samples,'aois':aois,'anchors':[{'gaze':0,'media':0}],'frameTimes':pts,'source':{'url':'https://zenodo.org/records/5031618','license':'CC0-1.0 (dataset); third-party page content retains its rights','citation':'Raphael Menges (2021), GazeMining 1.0.2, doi:10.5281/zenodo.5031618','synthetic':False,'originalTimeOrigin':'1552383049162 ms UTC','format':'GazeMining · left eye','rawUrl':'/datasets/gazemining-amazon-raw.json.gz','transform':'qtVideoTs ms → µs; left eye in viewport pixels; repeated Qt receipt timestamps are averaged within each millisecond. Missing and off-screen gaze preserved. No smoothing, timing jitter, or offset inferred.','rawSampleCount':len(j['Gaze']),'mergedDuplicateSamples':len(j['Gaze'])-len(samples),'upstreamParser':'https://github.com/raphaelmenges/visual-stimuli-discovery/blob/54d0699ed6b3041ab990dca3ce6bcf8217f840d0/code/src/lib/Stage/Processing/Parser.cpp'}}
(dest/'gazemining.json').write_text(json.dumps(record,separators=(',',':')))
checks={p.name:{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in [src/'amazon.webm',src/'amazon.json',src/'amazon_times.csv',src/'README.txt',dest/'gazemining.json']}
(root/'docs/gazemining-provenance.json').write_text(json.dumps({'dataset':'https://zenodo.org/records/5031618','version':'1.0.2','retrieved':'2026-09-06','rawSamples':len(j['Gaze']),'canonicalSamples':len(samples),'duplicatesMerged':len(j['Gaze'])-len(samples),'decodedFrames':len(pts),'maxFrameTimeDisagreementUs':max(abs(a-b) for a,b in zip(pts,supplied)),'files':checks},indent=2))
print(json.dumps({'rawSamples':len(j['Gaze']),'canonicalSamples':len(samples),'frames':len(pts),'frameClockMatches':pts==supplied}))
