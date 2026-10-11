-- +goose Up
CREATE TABLE setups (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 1,
    doc TEXT NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE TABLE scenes (
    id TEXT PRIMARY KEY,
    setup_id TEXT NOT NULL,
    name TEXT NOT NULL,
    version INTEGER NOT NULL,
    doc TEXT NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE TABLE ops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    author TEXT NOT NULL,
    ts DATETIME NOT NULL,
    ops TEXT NOT NULL,
    inverse TEXT NOT NULL
);
CREATE INDEX ops_scene_version ON ops (scene_id, version);
CREATE TABLE drafts (
    id TEXT PRIMARY KEY,
    scene_id TEXT NOT NULL,
    status TEXT NOT NULL,
    doc TEXT NOT NULL,
    base_doc TEXT NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX drafts_scene ON drafts (scene_id);
CREATE TABLE presets (
    id TEXT PRIMARY KEY,
    doc TEXT NOT NULL,
    created_at DATETIME NOT NULL
);
CREATE TABLE effects (
    id TEXT PRIMARY KEY,
    doc TEXT NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE TABLE assets (
    sha TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    bytes INTEGER NOT NULL,
    kind TEXT NOT NULL,
    thumb TEXT,
    created_at DATETIME NOT NULL
);
CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    token_hash TEXT,
    local INTEGER NOT NULL DEFAULT 0,
    session_id TEXT,
    last_seen DATETIME NOT NULL,
    created_at DATETIME NOT NULL
);
CREATE UNIQUE INDEX devices_token ON devices (token_hash) WHERE token_hash IS NOT NULL;
CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY,
    doc TEXT NOT NULL,
    created_at DATETIME NOT NULL
);
CREATE TABLE agent_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    doc TEXT NOT NULL
);
CREATE INDEX agent_events_session ON agent_events (session_id, seq);
CREATE TABLE calibrations (
    id TEXT PRIMARY KEY,
    setup_id TEXT NOT NULL,
    doc TEXT NOT NULL,
    created_at DATETIME NOT NULL
);
CREATE TABLE kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- +goose Down
DROP TABLE kv;
DROP TABLE calibrations;
DROP TABLE agent_events;
DROP TABLE agent_sessions;
DROP TABLE devices;
DROP TABLE assets;
DROP TABLE effects;
DROP TABLE presets;
DROP TABLE drafts;
DROP TABLE ops;
DROP TABLE scenes;
DROP TABLE setups;
