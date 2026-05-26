-- 0013_messages_pinned.sql
-- Add a `pinned_at` flag on messages so PinMessage / UnpinMessage can mark the message row
-- itself, in addition to creating the context-item the spec requires. The context-item is the
-- durable knowledge artifact; the flag is for fast UI rendering and the kebab toggle.
ALTER TABLE messages ADD COLUMN pinned_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_messages_pinned ON messages (room_id, pinned_at) WHERE pinned_at IS NOT NULL;
