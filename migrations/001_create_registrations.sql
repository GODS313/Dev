CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  province TEXT NOT NULL,
  answers TEXT,
  created_at DATETIME DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
  tracking_code TEXT UNIQUE
);
