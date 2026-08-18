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

CREATE TABLE IF NOT EXISTS rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  attempted_at DATETIME NOT NULL,
  success INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_ip ON rate_limits(ip);
