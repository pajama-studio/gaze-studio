import urllib.request,json,pathlib,struct,zlib,time
p=pathlib.Path('artifacts/research/emotion');parts=json.loads((p/'parts.json').read_text())
def read(offset,size):
 out=bytearray()
 for part in parts:
  if offset>=part['size']:offset-=part['size'];continue
  while offset<part['size'] and len(out)<size:
   n=min(size-len(out),part['size']-offset,8*1024*1024)
   req=urllib.request.Request(part['url'],headers={'Range':f'bytes={offset}-{offset+n-1}'})
   for attempt in range(4):
    try:
     with urllib.request.urlopen(req,timeout=50) as r:
      if r.status!=206:raise ValueError('Range required')
      b=r.read()
     if len(b)!=n:raise ValueError('Short read')
     break
    except Exception:
     if attempt==3:raise
     time.sleep(2)
   out.extend(b);offset+=n
  offset=0
  if len(out)==size:return bytes(out)
 raise ValueError('Beyond archive')
entries=json.loads((p/'entries.json').read_text());out=p/'P01-0a';out.mkdir(exist_ok=True)
for e in entries:
 if not e['name'].startswith('dataset/P01/0a/') or not e['name'].endswith(('.csv','.mp4')):continue
 f=out/e['name'].split('/')[-1]
 if f.exists() and f.stat().st_size==e['size']:continue
 h=read(e['offset'],30);nl,el=struct.unpack('<HH',h[26:30]);print('Downloading',e['name'],e['compressed'],flush=True)
 b=read(e['offset']+30+nl+el,e['compressed']);b=zlib.decompress(b,-15) if e['method']==8 else b
 assert len(b)==e['size'] and zlib.crc32(b)==e['crc'];f.write_bytes(b);print('Verified',f,len(b),flush=True)
(p/'selected-entries.json').write_text(json.dumps([e for e in entries if e['name'].startswith('dataset/P01/0a/') and e['size']>0],indent=2))
