CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  province TEXT NOT NULL,
  answers TEXT,
  ip TEXT,
  created_at DATETIME DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
  tracking_code TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_registrations_created_at ON registrations(created_at);
