"""Export actual video frame PTS for Gaze Studio. Requires ffprobe on PATH."""
import argparse,json,pathlib,subprocess
p=argparse.ArgumentParser();p.add_argument('video');p.add_argument('--out',required=True);a=p.parse_args()
j=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',a.video]))
times=[round(float(f['best_effort_timestamp_time'])*1e6) for f in j['frames']]
if not times or any(b<=a for a,b in zip(times,times[1:])):raise SystemExit('Non-monotonic frame timestamps; inspect or remux the media explicitly.')
pathlib.Path(a.out).write_text(json.dumps({'frame_times_us':times,'source':'ffprobe best_effort_timestamp_time','first_pts_us':times[0]},indent=2));print(f'Indexed {len(times)} frames. No FPS-based reconstruction.')
