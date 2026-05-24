ALTER TABLE messages ADD COLUMN brief_published_at INTEGER;

ALTER TABLE mailbox_messages ADD COLUMN delivery_failure_reason TEXT;
ALTER TABLE mailbox_messages ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE agent_profiles ADD COLUMN description TEXT;
ALTER TABLE agent_profiles ADD COLUMN avatar TEXT;
ALTER TABLE agent_profiles ADD COLUMN version TEXT;
ALTER TABLE agent_profiles ADD COLUMN provider TEXT;
ALTER TABLE agent_profiles ADD COLUMN default_presence TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_room_created_desc ON messages (room_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_runs_workspace_ended ON runs (workspace_id, ended_at DESC);
