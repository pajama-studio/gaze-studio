CREATE TABLE datasets (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
 source_url TEXT NOT NULL, license TEXT NOT NULL, revision TEXT NOT NULL,
 manifest_key TEXT, public INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL
);
CREATE TABLE dataset_assets (
 dataset TEXT NOT NULL REFERENCES datasets(id), path TEXT NOT NULL,
 r2_key TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL,
 mime TEXT NOT NULL, role TEXT NOT NULL, public INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(dataset,path)
);
CREATE INDEX dataset_assets_dataset ON dataset_assets(dataset,role);
