-- Modular automation tasks: per-task settings/state, independent enable flag and runs.
CREATE TABLE IF NOT EXISTS task_settings (
    task_key TEXT PRIMARY KEY,
    settings_json TEXT NOT NULL DEFAULT '{}',
    secret_enc TEXT,
    enabled INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    dedup_key TEXT,
    ref TEXT,
    result TEXT,
    log_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS task_runs_task ON task_runs(task_key, status);
