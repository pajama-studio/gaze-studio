"""Read the public GazeMining ZIP directory via HTTP ranges; avoid a 4.7 GB download."""
import io, urllib.request, zipfile, json, pathlib, sys
URL = 'https://zenodo.org/api/records/5031618/files/GazeMiningDataset.zip/content'
SIZE = 4656752885
class RemoteZip(io.RawIOBase):
    def __init__(self): self.position=0
    def seekable(self): return True
    def seek(self, offset, whence=0):
        self.position = offset if whence==0 else self.position+offset if whence==1 else SIZE+offset
        return self.position
    def tell(self): return self.position
    def read(self, size=-1):
        if size<0: size=SIZE-self.position
        if size==0: return b''
        end=min(SIZE-1,self.position+size-1)
        req=urllib.request.Request(URL+'?range_start='+str(self.position),headers={'Range':f'bytes={self.position}-{end}'})
        with urllib.request.urlopen(req,timeout=60) as r:
            if r.status!=206: raise RuntimeError('Server did not honor byte range')
            data=r.read()
        self.position+=len(data)
        return data
p=pathlib.Path(__file__).resolve().parents[1]/'artifacts/gazemining'; p.mkdir(parents=True,exist_ok=True)
z=zipfile.ZipFile(RemoteZip())
(p/'index.json').write_text(json.dumps([{'name':i.filename,'bytes':i.file_size} for i in z.infolist()],indent=2))
if len(sys.argv)>1:
    for name in sys.argv[1:]:
        dest=p/pathlib.Path(name).name; dest.write_bytes(z.read(name)); print(dest, dest.stat().st_size,flush=True)
else:
    for info in z.infolist():
        if (info.filename.endswith('.webm') and info.file_size<20000000) or 'license' in info.filename.lower() or 'readme' in info.filename.lower(): print(info.filename,info.file_size,flush=True)
