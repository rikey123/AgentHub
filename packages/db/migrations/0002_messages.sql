CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'agent', 'system')),
  sender_id TEXT,
  run_id TEXT,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  quoted_message_id TEXT,
  turn_dispatch_mode TEXT NOT NULL DEFAULT 'immediate' CHECK (turn_dispatch_mode IN ('immediate', 'pending')),
  pending_turn_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE message_parts (
  message_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  part_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, seq)
);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  byte_size INTEGER NOT NULL,
  sha256 TEXT,
  storage_path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_messages_room_created ON messages (room_id, created_at);
CREATE INDEX idx_messages_pending ON messages (room_id, turn_dispatch_mode);
CREATE INDEX idx_message_parts_message ON message_parts (message_id, seq);
CREATE INDEX idx_attachments_message ON attachments (message_id, created_at);
