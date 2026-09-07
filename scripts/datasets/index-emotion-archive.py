import urllib.request,json,pathlib,struct,zlib
p=pathlib.Path('artifacts/research/emotion');p.mkdir(parents=True,exist_ok=True);parts=[]
for id in ['16794721','16794737','16794742']:
 d=json.load(urllib.request.urlopen('https://zenodo.org/api/records/'+id));(p/(id+'.json')).write_text(json.dumps(d));f=d['files'][0];parts.append({'url':'https://zenodo.org/records/'+id+'/files/'+f['key']+'?download=1','size':f['size']})
(p/'parts.json').write_text(json.dumps(parts))
def read(offset,size):
 out=b''
 for part in parts:
  if offset>=part['size']:offset-=part['size'];continue
  n=min(size-len(out),part['size']-offset)
  req=urllib.request.Request(part['url'],headers={'Range':f'bytes={offset}-{offset+n-1}'})
  with urllib.request.urlopen(req,timeout=60) as r:
   if r.status!=206:raise ValueError('Range not supported')
   b=r.read()
  if len(b)!=n:raise ValueError('Short read')
  out+=b;offset=0
  if len(out)==size:return out
 raise ValueError('Beyond archive')
tail=read(sum(v["size"] for v in parts)-65536,65536);j=tail.rfind(b"PK\x06\x06");assert j>=0;h=struct.unpack("<4sQ2H2I4Q",tail[j:j+56]);cd=read(h[-1],h[-2]);(p/'central.bin').write_bytes(cd);offset=0;entries=[]
while cd[offset:offset+4]==b'PK\x01\x02':
 h=struct.unpack('<4s6H3I5H2I',cd[offset:offset+46]);_,made,need,flag,method,t,d,crc,cs,us,nl,el,cl,disk,ia,ea,lo=h
 name=cd[offset+46:offset+46+nl].decode();extra=cd[offset+46+nl:offset+46+nl+el];ei=0
 while ei+4<=len(extra):
  tag,n=struct.unpack('<HH',extra[ei:ei+4]);data=extra[ei+4:ei+4+n]
  if tag==1:
   vals=list(struct.unpack('<'+'Q'*(len(data)//8),data))
   if us==0xffffffff:us=vals.pop(0)
   if cs==0xffffffff:cs=vals.pop(0)
   if lo==0xffffffff:lo=vals.pop(0)
  ei+=4+n
 entries.append(dict(name=name,size=us,compressed=cs,offset=lo,crc=crc,method=method));offset+=46+nl+el+cl
(p/'entries.json').write_text(json.dumps(entries,indent=2))
print("Indexed",len(entries),"archive entries without downloading the full dataset.")
