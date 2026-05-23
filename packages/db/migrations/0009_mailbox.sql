CREATE TABLE mailbox_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  from_type TEXT,
  from_id TEXT,
  to_agent_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  files TEXT NOT NULL DEFAULT '[]',
  read INTEGER NOT NULL DEFAULT 0,
  claimed_run_id TEXT,
  claimed_at INTEGER,
  delivery_batch_id TEXT,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE TABLE pending_turns (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  user_message_id TEXT NOT NULL UNIQUE,
  primary_agent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  enqueued_at INTEGER NOT NULL,
  scheduled_at INTEGER,
  cancelled_at INTEGER,
  notes TEXT
);

CREATE TABLE run_next_turns (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  prompt_delta_json TEXT NOT NULL,
  message_id TEXT,
  pending_turn_id TEXT,
  source_reason TEXT,
  source_idempotency_key TEXT,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE TABLE mailbox_deliveries (
  delivery_batch_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  mailbox_ids TEXT NOT NULL,
  next_turn_ids TEXT NOT NULL,
  delivered_at INTEGER NOT NULL,
  PRIMARY KEY (delivery_batch_id, run_id)
);

CREATE INDEX idx_mb_to_room_unread ON mailbox_messages (to_agent_id, room_id, read);
CREATE INDEX idx_mb_claimable ON mailbox_messages (to_agent_id, room_id, read, claimed_run_id);
CREATE INDEX idx_pending_turns_room_status ON pending_turns (room_id, status, enqueued_at);
CREATE INDEX idx_next_turns_run_unconsumed ON run_next_turns (run_id) WHERE consumed_at IS NULL;
CREATE INDEX idx_next_turns_room_agent ON run_next_turns (room_id, agent_id, created_at);
CREATE INDEX idx_mailbox_deliveries_run ON mailbox_deliveries (run_id, delivered_at);
