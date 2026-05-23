CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  room_id TEXT,
  task_id TEXT,
  run_id TEXT,
  message_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  applied_at INTEGER
);

CREATE TABLE artifact_files (
  artifact_id TEXT NOT NULL,
  path TEXT NOT NULL,
  old_content TEXT,
  new_content TEXT,
  patch TEXT,
  additions INTEGER,
  deletions INTEGER,
  file_status TEXT NOT NULL,
  old_sha256 TEXT,
  new_sha256 TEXT,
  applied_state TEXT,
  content_path TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (artifact_id, path)
);

CREATE INDEX idx_art_room ON artifacts (room_id, created_at);
CREATE INDEX idx_art_status ON artifacts (status, created_at);
