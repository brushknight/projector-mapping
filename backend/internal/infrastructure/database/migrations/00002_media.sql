-- +goose Up
ALTER TABLE assets ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE assets ADD COLUMN duration REAL;
ALTER TABLE assets ADD COLUMN peaks TEXT;
CREATE INDEX assets_kind ON assets (kind, created_at);
CREATE TABLE videos (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    ref TEXT NOT NULL,
    source TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    youtube_id TEXT NOT NULL DEFAULT '',
    sha TEXT NOT NULL DEFAULT '',
    thumb TEXT,
    duration REAL NOT NULL DEFAULT 0,
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL
);

-- +goose Down
DROP TABLE videos;
DROP INDEX assets_kind;
ALTER TABLE assets DROP COLUMN peaks;
ALTER TABLE assets DROP COLUMN duration;
ALTER TABLE assets DROP COLUMN name;
