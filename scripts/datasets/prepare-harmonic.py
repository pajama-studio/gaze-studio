"""Convert the official HARMONIC sample into a portable binocular Gaze Package using frame capture timestamps.
python3 scripts/datasets/prepare-harmonic.py --input artifacts/research/harmonic/extracted
"""
from pathlib import Path
import argparse,ast,struct,json,csv,bisect,subprocess,hashlib,gzip,zipfile,io,math
parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--output',default='artifacts/library/harmonic-p122-011/replay');parser.add_argument('--start',type=float,default=10);parser.add_argument('--end',type=float,default=30);args=parser.parse_args();p=Path(args.input);out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
def npy(file):
 with file.open('rb') as f:
  magic=f.read(8);assert magic[:6]==b'\x93NUMPY' and magic[6]==1
  n=struct.unpack('<H',f.read(2))[0];h=ast.literal_eval(f.read(n).decode());assert h['descr']=='<f8' and not h['fortran_order'];b=f.read();return list(struct.unpack('<'+'d'*(len(b)//8),b))
def probe(file):
 d=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_streams','-show_frames','-show_entries','stream=width,height,duration:frame=best_effort_timestamp_time','-of','json',str(file)]));return d['streams'][0],[round(float(f['best_effort_timestamp_time'])*1e6) for f in d['frames']]
def mapped(t,anchors):
 i=max(0,min(len(anchors)-2,bisect.bisect_right([a['gaze'] for a in anchors],t)-1));a,b=anchors[i:i+2];return a['media']+(t-a['gaze'])*(b['media']-a['media'])/(b['gaze']-a['gaze'])
tracks=[];frames={};capture={}
for name in ['world','eye0','eye1']:
 ts=npy(p/(name+'_timestamps.npy'));source,source_pts=probe(p/(name+'.mp4'));assert len(ts)==len(source_pts)
 lo=bisect.bisect_left(ts,args.start);hi=bisect.bisect_left(ts,args.end);assert hi>lo
 target=out/(name+'.mp4');subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(p/(name+'.mp4')),'-an','-vf',f'trim=start_frame={lo}:end_frame={hi},setpts=PTS-STARTPTS','-fps_mode','passthrough','-enc_time_base','1:1000000','-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p','-movflags','+faststart','-video_track_timescale','1000000',str(target)],check=True)
 stream,pts=probe(target);assert len(pts)==hi-lo;frames[name]=pts;capture[name]=ts[lo:hi]
 if name=='world':
  anchors=[{'gaze':round((t-args.start)*1e6),'media':v} for t,v in zip(capture[name],pts)];duration=round(float(stream['duration'])*1e6)
 else:
  a=[{'gaze':round(mapped((t-args.start)*1e6,anchors)),'media':v} for t,v in zip(capture[name],pts)];tracks.append({'id':name,'role':'right-eye' if name=='eye0' else 'left-eye','name':name+'.mp4','url':'media/'+name+'.mp4','width':stream['width'],'height':stream['height'],'duration':round(float(stream['duration'])*1e6),'start':max(0,a[0]['gaze']),'end':min(duration,a[-1]['gaze']+8333),'anchors':a,'frameTimes':pts,'source':'Pupil eye camera; exact frame-to-capture-time association from original NPY sidecar.'})
 print(name,len(pts),'indexed capture frames',flush=True)
samples=[];seen=set()
for row in csv.DictReader((p/'gaze_positions.csv').open()):
 t=round((float(row['timestamp'])-args.start)*1e6)
 if not 0<=mapped(t,anchors)<duration or t in seen:continue
 seen.add(t);x=float(row['norm_pos_x'])*1280;y=(1-float(row['norm_pos_y']))*720;samples.append({'t':t,'x':x if math.isfinite(x) else None,'y':y if math.isfinite(y) else None,'valid':float(row['confidence'])>=.6 and math.isfinite(x) and math.isfinite(y),'participant':'P122'})
signals=[]
for name,eye in [('pupil_eye0.csv','right'),('pupil_eye1.csv','left')]:
 seen=set()
 for row in csv.DictReader((p/name).open()):
  t=round((float(row['timestamp'])-args.start)*1e6)
  if not 0<=mapped(t,anchors)<duration or t in seen:continue
  seen.add(t);diam=float(row['diameter_3d']);signals.append({'t':t,'eye':eye,'confidence':float(row['confidence']),'pupil':diam if math.isfinite(diam) and diam>0 else None,'pupilUnit':'mm'})
signals.sort(key=lambda s:s['t'])
r={'id':'harmonic-p122-011','title':'HARMONIC · through the glasses','description':'Real P122 / run 011 · 10–30 s capture-time excerpt. Both eye cameras and world video aligned using original per-frame capture timestamps.','width':1280,'height':720,'duration':duration,'mediaUrl':'media/world.mp4','mediaName':'world.mp4','mediaType':'video','recordedEye':'cyclopean','samples':samples,'aois':[],'anchors':anchors,'videoTracks':tracks,'eyeSignals':signals,'frameTimes':frames['world'],'source':{'url':'https://harplab.github.io/harmonic/','license':'Public research download; no explicit redistribution license found. Private archive and local research replay.','citation':'Newman et al. (2021). HARMONIC: A multimodal dataset of assistive human–robot collaboration. DOI 10.1177/02783649211050677. P122 / run 011.','synthetic':False,'originalTimeOrigin':str(args.start),'format':'HARMONIC / Pupil Core binocular','transform':'Native eye0=right, eye1=left. Original NPY capture times joined by frame order to actual encoded PTS. No assumed common FPS. world_index columns ignored. H.264 CRF21 excerpt; no frames resampled; confidence ≥0.6; normalized bottom-left gaze converted to scene pixels.'}}
files={};raw=[]
for name in ['world','eye0','eye1']:files['media/'+name+'.mp4']=(out/(name+'.mp4')).read_bytes()
for name in ['world_timestamps.npy','eye0_timestamps.npy','eye1_timestamps.npy','gaze_positions.csv','pupil_eye0.csv','pupil_eye1.csv','run_info.yaml']:
 key='raw/'+name+'.gz';files[key]=gzip.compress((p/name).read_bytes(),mtime=0);raw.append({'name':name+'.gz','path':key,'type':'application/gzip'})
buf=io.StringIO();writer=csv.writer(buf);writer.writerow(['t_us','x_px','y_px','valid','participant_id']);writer.writerows([s['t'],s['x'],s['y'],int(s['valid']),s['participant']] for s in samples);files['gaze.csv']=buf.getvalue().encode();files['aois.json']=b'[]';files['frames.json']=json.dumps(frames['world']).encode()
metadata={k:v for k,v in r.items() if k not in ['samples','aois']};manifest={'format':'gaze-package','version':'0.2.0','coordinateSystem':'stimulus-pixels-top-left','timeUnit':'microseconds','clockExtrapolation':'linear','recording':metadata,'rawSources':raw,'files':[{'path':k,'bytes':len(v),'sha256':hashlib.sha256(v).hexdigest()} for k,v in files.items()]};files['manifest.json']=json.dumps(manifest).encode()
with zipfile.ZipFile(out/'harmonic.gaze.zip','w',compression=zipfile.ZIP_STORED) as z:
 for k,v in files.items():z.writestr(k,v)
(out/'recording.json').write_text(json.dumps(r));print('Portable package:',out/'harmonic.gaze.zip','samples',len(samples),'eye signals',len(signals))
