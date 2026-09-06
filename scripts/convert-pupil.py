"""Convert one Pupil Cloud section using integer epoch nanoseconds and real video PTS.
Does not download private data or assume a nominal frame rate.
"""
import argparse,csv,json,pathlib,subprocess
p=argparse.ArgumentParser();p.add_argument('--gaze',required=True);p.add_argument('--world',required=True);p.add_argument('--video',required=True);p.add_argument('--out',required=True);p.add_argument('--participant',default='P01');a=p.parse_args();out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
def read(path):
 with open(path,newline='',encoding='utf-8-sig') as f:return [{k.replace('\xa0',' '):v for k,v in row.items()} for row in csv.DictReader(f)]
gaze=read(a.gaze);world=read(a.world)
sections={row.get('section id','single') for row in world}
if len(sections)!=1:raise SystemExit('Select a single world-video section; timestamps cannot be guessed across multiple video files.')
frames=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',a.video]))['frames']
pts=[round(float(f['best_effort_timestamp_time'])*1e6) for f in frames]
if len(pts)!=len(world):raise SystemExit(f'Frame count mismatch: {len(pts)} decoded frames, {len(world)} world timestamps. Select the matching section.')
origin=int(world[0]['timestamp [ns]']); relative=lambda value:(1 if int(value)>=origin else -1)*(abs(int(value)-origin)//1000)
anchors=[{'gaze':relative(w['timestamp [ns]']),'media':t} for w,t in zip(world,pts)]
if any(b['gaze']<=a['gaze'] or b['media']<=a['media'] for a,b in zip(anchors,anchors[1:])):raise SystemExit('Frame clocks are not strictly increasing.')
with (out/'gaze.csv').open('w',newline='') as f:
 w=csv.writer(f);w.writerow(['t_us','x_px','y_px','valid','participant_id','blink']);last=None
 for row in gaze:
  if row.get('section id','single') not in sections:continue
  t=relative(row['timestamp [ns]'])
  if last is not None and t<=last:raise SystemExit('Duplicate or reversed gaze timestamp. Preserve the source and choose an explicit aggregation policy.')
  last=t;x=row['gaze x [px]'];y=row['gaze y [px]'];valid=bool(x and y and x.lower()!='nan' and y.lower()!='nan' and float(row.get('worn','1'))>0)
  w.writerow([t,x,y,int(valid),a.participant,int(bool(row.get('blink id','')))])
(out/'frame-clock.json').write_text(json.dumps({'frame_times_us':pts,'anchors':anchors,'origin_ns':str(origin),'source':'Pupil Cloud world_timestamps.csv matched one-to-one with decoded video PTS'},indent=2))
print('Import gaze.csv with origin 0 and unit microseconds; then Sync → Import frame clock → frame-clock.json. Preserve the original export alongside the Gaze Package.')
