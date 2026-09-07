"""Create a reproducible 20 s binocular replay from the CC BY 4.0 P01/0a research recording.
Requires ffmpeg/ffprobe. No eye inference, gaze interpolation or frame-rate resampling.
"""
from pathlib import Path
import csv,json,subprocess,statistics,bisect,hashlib,math,argparse
parser=argparse.ArgumentParser();parser.add_argument('--input',default='artifacts/research/emotion/P01-0a');parser.add_argument('--output',default='artifacts/library/emotion-p01-0a/v1');args=parser.parse_args()
p=Path(args.input);out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
probe={}
for name in ['world','eye0','eye1']:
 d=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_streams','-show_frames','-show_entries','stream=width,height,duration,start_time:frame=best_effort_timestamp_time','-of','json',str(p/(name+'.mp4'))]));probe[name]={'stream':d['streams'][0],'pts':[float(f['best_effort_timestamp_time']) for f in d['frames']]}
(p/'probe.json').write_text(json.dumps(probe));gaze=list(csv.DictReader((p/'gaze.csv').open()));pupil=list(csv.DictReader((p/'pupil.csv').open()))
# world_index associates gaze to recorded world frames. Estimate the shared epoch from the midpoint of each frame's sample interval.
groups={}
for row in gaze:groups.setdefault(int(row['world_index']),[]).append(float(row['gaze_timestamp']))
world=probe['world']['pts'];pairs=[(statistics.mean(ts),world[i]) for i,ts in groups.items() if i<len(world) and i>2 and len(ts)>1]
epoch=statistics.median(g-p for g,p in pairs);residual=sorted(abs((g-epoch)-p)*1e3 for g,p in pairs)
# All media retain their PTS offsets relative to the common cut, including their first-frame offset.
cut=4.;end=24.;duration=round((end-cut)*1e6);track_meta=[]
for name in ['world','eye0','eye1']:
 target=out/(name+'.mp4')
 subprocess.run(['ffmpeg','-y','-loglevel','error','-copyts','-i',str(p/(name+'.mp4')),'-an','-vf',f'trim=start={cut}:end={end},setpts=PTS-{cut}/TB','-fps_mode','passthrough','-enc_time_base','1:1000000','-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p','-movflags','+faststart','-video_track_timescale','1000000',str(target)],check=True)
 d=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_streams','-show_frames','-show_entries','stream=width,height,duration,start_time:frame=best_effort_timestamp_time','-of','json',str(target)]))
 pts=[round(float(f['best_effort_timestamp_time'])*1e6) for f in d['frames']];src=[round((t-cut)*1e6) for t in probe[name]['pts'] if cut<=t<end]
 assert len(src)==len(pts),(name,len(src),len(pts))
 max_delta=max(abs(a-b) for a,b in zip(src,pts));assert max_delta<=1000,(name,max_delta)
 s=d['streams'][0];meta={'id':name,'name':name+'.mp4','url':f'/api/datasets/emotion-p01-0a/assets/{name}.mp4','width':s['width'],'height':s['height'],'duration':round((float(s['start_time'])+float(s['duration']))*1e6),'start':max(0,pts[0]),'end':min(duration,pts[-1]+8333),'anchors':[{'gaze':0,'media':0}],'frameTimes':pts,'source':'Original encoded PTS preserved after a common 4 s cut; no per-frame capture timestamp sidecar supplied.'}
 track_meta.append(meta);print(name,'frames',len(pts),'max PTS transform error',max_delta,'us',flush=True)
samples=[];seen=set();origin=epoch+cut
for row in gaze:
 t=round((float(row['gaze_timestamp'])-origin)*1e6)
 if not 0<=t<duration or t in seen:continue
 seen.add(t);x=float(row['norm_pos_x'])*640;y=(1-float(row['norm_pos_y']))*480;valid=float(row['confidence'])>=.6 and math.isfinite(x) and math.isfinite(y)
 samples.append({'t':t,'x':x if math.isfinite(x) else None,'y':y if math.isfinite(y) else None,'valid':valid,'participant':'P01'})
signals=[];seen=set()
for row in pupil:
 t=round((float(row['pupil_timestamp'])-origin)*1e6);eye='left' if row['eye_id']=='1' else 'right';key=(t,eye)
 if not 0<=t<duration or key in seen:continue
 seen.add(key);signals.append({'t':t,'eye':eye,'confidence':float(row['confidence']),'pupil':float(row['diameter']) if float(row['diameter'])>0 else None,'pupilUnit':'px'})
signals.sort(key=lambda s:s['t'])
sync={'method':'Median gaze epoch estimated from world_index frame-group midpoints; video streams use their original common encoded PTS.','epochSeconds':format(epoch,'.9f'),'cutSeconds':[cut,end],'frameGroupResidualMedianMs':statistics.median(residual),'frameGroupResidualP95Ms':residual[round(.95*(len(residual)-1))],'limitations':'No independent camera capture timestamp sidecars or synchronization ground truth are distributed in this trial. Residuals measure agreement with frame assignments, not physical capture latency or tracker accuracy.'}
(out/'synchronization.json').write_text(json.dumps(sync,indent=2))
recording={'id':'emotion-p01-0a','title':'Through both eyes','description':'A real binocular VR recording · P01 / neutral 0a · 20-second excerpt. Original left/right eye imagery, scene video and derived pupil signals. Alignment estimated from recorded world-frame assignments.','width':640,'height':480,'duration':duration,'mediaUrl':track_meta[0]['url'],'mediaName':'world.mp4','mediaType':'video','samples':samples,'aois':[],'anchors':[{'gaze':0,'media':0}],'recordedEye':'cyclopean','frameTimes':track_meta[0]['frameTimes'],'videoTracks':[{**t,'role':'right-eye' if t['id']=='eye0' else 'left-eye'} for t in track_meta[1:]],'eyeSignals':signals,'source':{'url':'https://zenodo.org/records/16794721','license':'Dataset CC BY 4.0; film stimulus retains third-party rights. Short excerpt for research replay.','citation':'Yang, Regmi, Du, Bulling, Zhang & Lan (2025). Through the Eyes of Emotion. IMWUT 9(3), 143. DOI: 10.1145/3749545. P01 / 0a.','synthetic':False,'originalTimeOrigin':format(origin,'.9f'),'format':'Through the Eyes of Emotion · binocular IR + VR scene','transform':f'4–24 s excerpt, H.264 CRF21 VFR; no frames resampled. Normalized bottom-left gaze → 640×480 top-left. Valid confidence ≥0.6. Epoch estimated from world_index; median residual {statistics.median(residual):.2f} ms, P95 {residual[round(.95*(len(residual)-1))]:.2f} ms. Pupil in image pixels, not millimetres.'}}
(out/'recording.json').write_text(json.dumps(recording,separators=(',',':')))
print('samples',len(samples),'eye signals',len(signals),'sync',sync)
