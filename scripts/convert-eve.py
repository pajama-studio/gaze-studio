"""Explicit HDF5 label bridge for EVE-style data/data-validity groups.
Requires h5py and numpy. Use only an authorized local dataset download.
No model execution or benchmark score is fabricated by this converter.
"""
import argparse,csv,pathlib
p=argparse.ArgumentParser();p.add_argument('--h5',required=True);p.add_argument('--timestamps');p.add_argument('--timestamp-unit',choices=['s','ms','us','ns']);p.add_argument('--origin',default='0');p.add_argument('--gaze-key',help='HDF5 group containing Nx2 pixel data and validity');p.add_argument('--participant',required=True);p.add_argument('--out',default='reference.csv');p.add_argument('--inspect',action='store_true');a=p.parse_args()
try:import h5py
except ImportError:raise SystemExit('Install the optional converter dependencies: python -m pip install h5py numpy')
with h5py.File(a.h5,'r') as h:
 if a.inspect:
  h.visititems(lambda name,obj:print(name,getattr(obj,'shape','group')));raise SystemExit(0)
 if not a.gaze_key or not a.timestamps or not a.timestamp_unit:raise SystemExit('Specify gaze group, matching timestamp file, and its unit explicitly. Use --inspect to inspect available labels.')
 group=h[a.gaze_key];data=group['data'][:];validity=group['validity'][:]
 if data.ndim!=2 or data.shape[1]!=2:raise SystemExit('Expected Nx2 screen-pixel labels; gaze angles/vectors require a geometry-aware conversion.')
 times=pathlib.Path(a.timestamps).read_text().split()
 if len(times)!=len(data):raise SystemExit('Timestamps and gaze label counts differ. Never align by assumed FPS.')
 factor={'s':1000000,'ms':1000,'us':1}
 from decimal import Decimal,ROUND_HALF_UP
 def relative(t):
  delta=Decimal(t)-Decimal(a.origin)
  return int(delta/1000) if a.timestamp_unit=='ns' else int((delta*factor[a.timestamp_unit]).to_integral_value(rounding=ROUND_HALF_UP))
 with open(a.out,'w',newline='') as f:
  writer=csv.writer(f);writer.writerow(['t_us','x_px','y_px','valid','participant_id'])
  for t,xy,valid in zip(times,data,validity):writer.writerow([relative(t),float(xy[0]),float(xy[1]),int(bool(valid.all())),a.participant])
print('Wrote reference labels. Predictions must use the same source timestamps, screen pixel space, participant IDs, and evaluation split. Keep intrinsics/extrinsics with the original data.')
