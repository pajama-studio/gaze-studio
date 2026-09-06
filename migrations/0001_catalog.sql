CREATE TABLE sessions (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, created INTEGER NOT NULL);
CREATE TABLE recordings (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES sessions(id), title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', manifest TEXT NOT NULL, created INTEGER NOT NULL, bytes INTEGER NOT NULL DEFAULT 0);
CREATE INDEX recordings_owner ON recordings(owner, created);
CREATE TABLE objects (recording TEXT NOT NULL REFERENCES recordings(id), name TEXT NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY(recording,name));
CREATE TABLE quotas (key TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE detections (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES sessions(id), model TEXT NOT NULL, created INTEGER NOT NULL, result TEXT NOT NULL);
