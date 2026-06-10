ALTER TABLE wake_outbox RENAME TO wake_outbox_old;

CREATE TABLE wake_outbox (
  id             TEXT PRIMARY KEY,
  room_id        TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  reason         TEXT NOT NULL,
  payload        TEXT,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatching', 'dispatched', 'failed')),
  attempt_count  INTEGER NOT NULL DEFAULT 0,
  max_attempts   INTEGER NOT NULL DEFAULT 3,
  last_error     TEXT,
  created_at     INTEGER NOT NULL,
  dispatch_after INTEGER,
  dispatched_at  INTEGER,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agent_bindings(id) ON DELETE CASCADE
);

INSERT INTO wake_outbox (
  id, room_id, agent_id, reason, payload, status, attempt_count, max_attempts,
  last_error, created_at, dispatch_after, dispatched_at
)
SELECT
  old.id, old.room_id, old.agent_id, old.reason, old.payload, old.status,
  old.attempt_count, old.max_attempts, old.last_error, old.created_at,
  old.dispatch_after, old.dispatched_at
FROM wake_outbox_old old
WHERE EXISTS (SELECT 1 FROM rooms WHERE rooms.id = old.room_id)
  AND EXISTS (SELECT 1 FROM agent_bindings WHERE agent_bindings.id = old.agent_id);

DROP TABLE wake_outbox_old;

CREATE INDEX idx_wake_outbox_status_dispatch_after ON wake_outbox(status, dispatch_after, created_at);
